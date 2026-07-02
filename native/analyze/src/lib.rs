use std::{
    alloc::{Layout, alloc as rust_alloc, dealloc},
    cell::RefCell,
    collections::BTreeMap,
    path::Path,
    slice, str,
};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Declaration, ExportDefaultDeclarationKind, ImportDeclarationSpecifier,
        ImportOrExportKind, ModuleExportName, Statement, VariableDeclarationKind,
    },
};
use oxc_ast_visit::utf8_to_utf16::{Utf8ToUtf16, Utf8ToUtf16Converter};
use oxc_diagnostics::{OxcDiagnostic, Severity};
use oxc_parser::{ParseOptions as OxcParseOptions, Parser};
use oxc_semantic::SemanticBuilder;
use oxc_span::{GetSpan, SourceType, Span};
use oxc_syntax::scope::ScopeFlags;
use oxc_syntax::symbol::{SymbolFlags, SymbolId};
use serde::{Deserialize, Serialize};

const ABI_VERSION: u32 = 1;

thread_local! {
    static RESULTS: RefCell<BTreeMap<u32, Vec<u8>>> = const { RefCell::new(BTreeMap::new()) };
    static NEXT_RESULT: RefCell<u32> = const { RefCell::new(1) };
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AnalyzeOptions {
    lang: Option<String>,
    source_type: Option<String>,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct SpanPayload {
    start: u32,
    end: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScopeFactPayload {
    id: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_id: Option<usize>,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    span: Option<SpanPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BindingFactPayload {
    id: usize,
    name: String,
    kind: &'static str,
    flags: Vec<&'static str>,
    scope_id: usize,
    span: SpanPayload,
    references: Vec<usize>,
    mutated: bool,
    unused: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReferenceFactPayload {
    id: usize,
    name: String,
    kind: &'static str,
    flags: Vec<&'static str>,
    scope_id: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    binding_id: Option<usize>,
    span: SpanPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportFactPayload {
    source: String,
    local: String,
    imported: String,
    kind: &'static str,
    span: SpanPayload,
    source_span: SpanPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportFactPayload {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    local: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exported: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    export_kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    declaration_kind: Option<&'static str>,
    span: SpanPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JsxTagFactPayload {
    name: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    binding_id: Option<usize>,
    span: SpanPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeSuccessPayload {
    abi_version: u32,
    kind: &'static str,
    ok: bool,
    scopes: Vec<ScopeFactPayload>,
    bindings: Vec<BindingFactPayload>,
    references: Vec<ReferenceFactPayload>,
    unresolved: Vec<ReferenceFactPayload>,
    imports: Vec<ImportFactPayload>,
    exports: Vec<ExportFactPayload>,
    jsx_tags: Vec<JsxTagFactPayload>,
    diagnostics: Vec<DiagnosticPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeFailurePayload {
    abi_version: u32,
    kind: &'static str,
    ok: bool,
    scopes: Vec<serde_json::Value>,
    bindings: Vec<serde_json::Value>,
    references: Vec<serde_json::Value>,
    unresolved: Vec<serde_json::Value>,
    imports: Vec<serde_json::Value>,
    exports: Vec<serde_json::Value>,
    jsx_tags: Vec<serde_json::Value>,
    diagnostics: Vec<DiagnosticPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticPayload {
    severity: &'static str,
    message: String,
    file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end: Option<u32>,
}

#[unsafe(no_mangle)]
pub extern "C" fn abi_version() -> u32 {
    ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return std::ptr::null_mut();
    }
    let Ok(layout) = Layout::array::<u8>(len) else {
        return std::ptr::null_mut();
    };
    unsafe { rust_alloc(layout) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    if let Ok(layout) = Layout::array::<u8>(len) {
        unsafe {
            dealloc(ptr, layout);
        }
    }
}

struct SpanConverter<'a> {
    converter: Option<Utf8ToUtf16Converter<'a>>,
}

impl<'a> SpanConverter<'a> {
    fn new(table: &'a Utf8ToUtf16) -> Self {
        Self {
            converter: table.converter(),
        }
    }

    fn convert(&mut self, span: Span) -> SpanPayload {
        let mut start = span.start;
        let mut end = span.end;
        if let Some(ref mut conv) = self.converter {
            conv.convert_offset(&mut start);
            conv.convert_offset(&mut end);
        }
        SpanPayload { start, end }
    }
}

fn scope_kind(flags: ScopeFlags) -> &'static str {
    if flags.is_top() {
        "root"
    } else if flags.is_function() {
        "function"
    } else if flags.is_catch_clause() {
        "catch"
    } else if flags.is_ts_module_block() {
        "ts-module"
    } else if flags.is_block() {
        "block"
    } else {
        "unknown"
    }
}

fn binding_kind(flags: SymbolFlags, declaration_kind: Option<&'static str>) -> &'static str {
    if flags.is_import() {
        "import"
    } else if flags.is_function() {
        "function"
    } else if flags.is_class() {
        "class"
    } else if flags.is_const_variable() {
        "const"
    } else if let Some(
        kind @ ("interface" | "enum" | "enum-member" | "type" | "param" | "let" | "var"),
    ) = declaration_kind
    {
        kind
    } else if flags.is_interface() {
        "interface"
    } else if flags.is_enum() {
        "enum"
    } else if flags.is_type_alias() {
        "type"
    } else if flags.is_block_scoped() {
        "let"
    } else if flags.is_variable() {
        "var"
    } else {
        "unknown"
    }
}

fn declaration_kind_for_symbol(
    semantic: &oxc_semantic::Semantic<'_>,
    symbol_id: SymbolId,
) -> Option<&'static str> {
    let nodes = semantic.nodes();
    let mut node_id = semantic.scoping().symbol_declaration(symbol_id);

    for _ in 0..8 {
        match nodes.kind(node_id) {
            AstKind::FormalParameter(_) | AstKind::FormalParameterRest(_) => return Some("param"),
            AstKind::TSTypeAliasDeclaration(_) => return Some("type"),
            AstKind::TSInterfaceDeclaration(_) => return Some("interface"),
            AstKind::TSEnumMember(_) => return Some("enum-member"),
            AstKind::TSEnumDeclaration(_) => return Some("enum"),
            AstKind::Function(_) => return Some("function"),
            AstKind::Class(_) => return Some("class"),
            AstKind::VariableDeclaration(decl) => {
                return Some(variable_declaration_kind(decl.kind));
            }
            AstKind::ImportSpecifier(_)
            | AstKind::ImportDefaultSpecifier(_)
            | AstKind::ImportNamespaceSpecifier(_) => return Some("import"),
            AstKind::Program(_) => return None,
            _ => {}
        }

        let parent_kind = nodes.parent_kind(node_id);
        match parent_kind {
            AstKind::FormalParameter(_) | AstKind::FormalParameterRest(_) => return Some("param"),
            AstKind::TSTypeAliasDeclaration(_) => return Some("type"),
            AstKind::TSInterfaceDeclaration(_) => return Some("interface"),
            AstKind::TSEnumMember(_) => return Some("enum-member"),
            AstKind::TSEnumDeclaration(_) => return Some("enum"),
            AstKind::Function(_) => return Some("function"),
            AstKind::Class(_) => return Some("class"),
            AstKind::VariableDeclaration(decl) => {
                return Some(variable_declaration_kind(decl.kind));
            }
            AstKind::ImportSpecifier(_)
            | AstKind::ImportDefaultSpecifier(_)
            | AstKind::ImportNamespaceSpecifier(_) => return Some("import"),
            AstKind::Program(_) => return None,
            _ => {
                let parent_id = nodes.parent_id(node_id);
                if parent_id == node_id {
                    return None;
                }
                node_id = parent_id;
            }
        }
    }

    None
}

fn variable_declaration_kind(kind: VariableDeclarationKind) -> &'static str {
    match kind {
        VariableDeclarationKind::Const => "const",
        VariableDeclarationKind::Let => "let",
        VariableDeclarationKind::Var => "var",
        VariableDeclarationKind::Using | VariableDeclarationKind::AwaitUsing => "const",
    }
}

fn export_value_kind(kind: ImportOrExportKind) -> &'static str {
    if kind.is_type() { "type" } else { "value" }
}

fn symbol_flags(flags: SymbolFlags) -> Vec<&'static str> {
    let mut list = Vec::new();
    if flags.is_import() {
        list.push("import");
    }
    if flags.is_type_import() {
        list.push("type_import");
    }
    if flags.is_function() {
        list.push("function");
    }
    if flags.is_class() {
        list.push("class");
    }
    if flags.is_const_variable() {
        list.push("const");
    }
    if flags.is_block_scoped() {
        list.push("block_scoped");
    }
    if flags.is_variable() {
        list.push("variable");
    }
    if flags.is_type_alias() {
        list.push("type_alias");
    }
    if flags.is_interface() {
        list.push("interface");
    }
    if flags.is_enum() {
        list.push("enum");
    }
    if flags.is_const_enum() {
        list.push("const_enum");
    }
    if flags.is_enum_member() {
        list.push("enum_member");
    }
    if flags.is_type_parameter() {
        list.push("type_parameter");
    }
    list
}

fn module_export_name_to_string(name: &ModuleExportName) -> String {
    match name {
        ModuleExportName::IdentifierName(id) => id.name.to_string(),
        ModuleExportName::IdentifierReference(id) => id.name.to_string(),
        ModuleExportName::StringLiteral(str) => str.value.to_string(),
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn analyze(
    filename_ptr: *const u8,
    filename_len: usize,
    source_ptr: *const u8,
    source_len: usize,
    options_ptr: *const u8,
    options_len: usize,
) -> u32 {
    store_result(unsafe {
        analyze_inner(
            filename_ptr,
            filename_len,
            source_ptr,
            source_len,
            options_ptr,
            options_len,
        )
    })
}

unsafe fn analyze_inner(
    filename_ptr: *const u8,
    filename_len: usize,
    source_ptr: *const u8,
    source_len: usize,
    options_ptr: *const u8,
    options_len: usize,
) -> Vec<u8> {
    let filename = unsafe { read_utf8(filename_ptr, filename_len) }.unwrap_or("<unknown>");
    let source = unsafe { read_utf8(source_ptr, source_len) }.unwrap_or("");
    let options = unsafe { read_utf8(options_ptr, options_len) }
        .and_then(|json| serde_json::from_str::<AnalyzeOptions>(json).ok())
        .unwrap_or_default();

    let converter_table = Utf8ToUtf16::new(source);
    let mut span_converter = SpanConverter::new(&converter_table);

    let allocator = Allocator::default();
    let source_type = source_type_for(filename, &options);
    let parse_options = OxcParseOptions::default();

    let parser_return = Parser::new(&allocator, source, source_type)
        .with_options(parse_options)
        .parse();

    let mut parse_diagnostics = parser_return.diagnostics;
    let program = parser_return.program;

    let semantic_return = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&program);

    let semantic = semantic_return.semantic;
    let mut semantic_diagnostics = semantic_return.diagnostics;

    // Check errors
    let mut has_errors = !parse_diagnostics.is_empty();
    if !has_errors {
        for diagnostic in &semantic_diagnostics {
            if diagnostic.severity == Severity::Error {
                has_errors = true;
                break;
            }
        }
    }

    if has_errors {
        parse_diagnostics.append(&mut semantic_diagnostics);
        let diagnostic_payloads = parse_diagnostics
            .iter()
            .map(|diagnostic| diagnostic_payload(filename, diagnostic))
            .collect::<Vec<_>>();

        return serde_json::to_vec(&AnalyzeFailurePayload {
            abi_version: ABI_VERSION,
            kind: "analyze",
            ok: false,
            scopes: vec![],
            bindings: vec![],
            references: vec![],
            unresolved: vec![],
            imports: vec![],
            exports: vec![],
            jsx_tags: vec![],
            diagnostics: diagnostic_payloads,
        })
        .unwrap();
    }

    let scoping = semantic.scoping();

    // 1. Scopes
    let mut scopes = Vec::new();
    for scope_id in scoping.scope_descendants_from_root() {
        let node_id = scoping.get_node_id(scope_id);
        let node = semantic.nodes().get_node(node_id);
        let span_payload = Some(span_converter.convert(node.span()));
        scopes.push(ScopeFactPayload {
            id: scope_id.index(),
            parent_id: scoping.scope_parent_id(scope_id).map(|id| id.index()),
            kind: scope_kind(scoping.scope_flags(scope_id)),
            span: span_payload,
        });
    }

    // 2. Bindings
    let mut bindings = Vec::new();
    for symbol_id in scoping.symbol_ids() {
        let name = scoping.symbol_name(symbol_id).to_string();
        let declaration_kind = declaration_kind_for_symbol(&semantic, symbol_id);
        let kind = binding_kind(scoping.symbol_flags(symbol_id), declaration_kind);
        let flags = symbol_flags(scoping.symbol_flags(symbol_id));
        let scope_id = scoping.symbol_scope_id(symbol_id).index();
        let span = span_converter.convert(scoping.symbol_span(symbol_id));
        let references = scoping
            .get_resolved_reference_ids(symbol_id)
            .iter()
            .map(|id| id.index())
            .collect();
        let mutated = scoping.symbol_is_mutated(symbol_id);
        let unused = scoping.symbol_is_unused(symbol_id);

        bindings.push(BindingFactPayload {
            id: symbol_id.index(),
            name,
            kind,
            flags,
            scope_id,
            span,
            references,
            mutated,
            unused,
        });
    }

    // 3. References and Unresolved
    let mut references = Vec::new();
    let mut unresolved = Vec::new();
    for id in 0..scoping.references_len() {
        let reference_id = oxc_semantic::ReferenceId::from(id);
        let reference = scoping.get_reference(reference_id);
        let name = semantic.reference_name(reference).to_string();

        let flags_val = reference.flags();
        let mut flags = Vec::new();
        if flags_val.is_read() {
            flags.push("read");
        }
        if flags_val.is_write() {
            flags.push("write");
        }
        let kind = if flags_val.is_type() {
            "type"
        } else {
            "identifier"
        };

        let scope_id = reference.scope_id().index();
        let binding_id = reference.symbol_id().map(|sid| sid.index());
        let span = span_converter.convert(semantic.reference_span(reference));

        let payload = ReferenceFactPayload {
            id,
            name,
            kind,
            flags,
            scope_id,
            binding_id,
            span,
        };

        if binding_id.is_none() {
            unresolved.push(payload.clone());
        }
        references.push(payload);
    }

    // 4. Imports and Exports
    let mut imports = Vec::new();
    let mut exports = Vec::new();

    for stmt in &program.body {
        match stmt {
            Statement::ImportDeclaration(import_decl) => {
                let source_str = import_decl.source.value.to_string();
                let source_span = span_converter.convert(import_decl.source.span);
                let is_type_decl = import_decl.import_kind.is_type();

                if let Some(specifiers) = &import_decl.specifiers {
                    for specifier in specifiers {
                        let (local, imported, span, spec_is_type) = match specifier {
                            ImportDeclarationSpecifier::ImportSpecifier(spec) => {
                                let local = spec.local.name.to_string();
                                let imported = module_export_name_to_string(&spec.imported);
                                let span = span_converter.convert(spec.span);
                                let is_type = is_type_decl || spec.import_kind.is_type();
                                (local, imported, span, is_type)
                            }
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(spec) => {
                                let local = spec.local.name.to_string();
                                let imported = "default".to_string();
                                let span = span_converter.convert(spec.span);
                                (local, imported, span, is_type_decl)
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(spec) => {
                                let local = spec.local.name.to_string();
                                let imported = "namespace".to_string();
                                let span = span_converter.convert(spec.span);
                                (local, imported, span, is_type_decl)
                            }
                        };
                        let kind = if spec_is_type { "type" } else { "value" };

                        imports.push(ImportFactPayload {
                            source: source_str.clone(),
                            local,
                            imported,
                            kind,
                            span,
                            source_span,
                        });
                    }
                }
            }
            Statement::ExportNamedDeclaration(export_decl) => {
                let source_str = export_decl.source.as_ref().map(|s| s.value.to_string());
                let export_span = span_converter.convert(export_decl.span);

                if let Some(decl) = &export_decl.declaration {
                    match decl {
                        Declaration::FunctionDeclaration(func) => {
                            if let Some(id) = &func.id {
                                exports.push(ExportFactPayload {
                                    kind: "named",
                                    local: Some(id.name.to_string()),
                                    exported: Some(id.name.to_string()),
                                    source: source_str.clone(),
                                    export_kind: Some("value"),
                                    declaration_kind: Some("function"),
                                    span: export_span,
                                });
                            }
                        }
                        Declaration::ClassDeclaration(class_decl) => {
                            if let Some(id) = &class_decl.id {
                                exports.push(ExportFactPayload {
                                    kind: "named",
                                    local: Some(id.name.to_string()),
                                    exported: Some(id.name.to_string()),
                                    source: source_str.clone(),
                                    export_kind: Some("value"),
                                    declaration_kind: Some("class"),
                                    span: export_span,
                                });
                            }
                        }
                        Declaration::VariableDeclaration(var_decl) => {
                            let declaration_kind = variable_declaration_kind(var_decl.kind);
                            for declarator in &var_decl.declarations {
                                if let BindingPattern::BindingIdentifier(id) = &declarator.id {
                                    exports.push(ExportFactPayload {
                                        kind: "named",
                                        local: Some(id.name.to_string()),
                                        exported: Some(id.name.to_string()),
                                        source: source_str.clone(),
                                        export_kind: Some("value"),
                                        declaration_kind: Some(declaration_kind),
                                        span: export_span,
                                    });
                                }
                            }
                        }
                        Declaration::TSTypeAliasDeclaration(type_decl) => {
                            exports.push(ExportFactPayload {
                                kind: "named",
                                local: Some(type_decl.id.name.to_string()),
                                exported: Some(type_decl.id.name.to_string()),
                                source: source_str.clone(),
                                export_kind: Some("type"),
                                declaration_kind: Some("type"),
                                span: export_span,
                            });
                        }
                        Declaration::TSInterfaceDeclaration(interface_decl) => {
                            exports.push(ExportFactPayload {
                                kind: "named",
                                local: Some(interface_decl.id.name.to_string()),
                                exported: Some(interface_decl.id.name.to_string()),
                                source: source_str.clone(),
                                export_kind: Some("type"),
                                declaration_kind: Some("interface"),
                                span: export_span,
                            });
                        }
                        Declaration::TSEnumDeclaration(enum_decl) => {
                            exports.push(ExportFactPayload {
                                kind: "named",
                                local: Some(enum_decl.id.name.to_string()),
                                exported: Some(enum_decl.id.name.to_string()),
                                source: source_str.clone(),
                                export_kind: Some("value"),
                                declaration_kind: Some("enum"),
                                span: export_span,
                            });
                        }
                        _ => {}
                    }
                }

                for spec in &export_decl.specifiers {
                    let local = module_export_name_to_string(&spec.local);
                    let exported = module_export_name_to_string(&spec.exported);
                    let export_kind =
                        if export_decl.export_kind.is_type() || spec.export_kind.is_type() {
                            "type"
                        } else {
                            "value"
                        };
                    exports.push(ExportFactPayload {
                        kind: "named",
                        local: Some(local),
                        exported: Some(exported),
                        source: source_str.clone(),
                        export_kind: Some(export_kind),
                        declaration_kind: None,
                        span: span_converter.convert(spec.span),
                    });
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                let export_span = span_converter.convert(export_decl.span);
                let (local_name, export_kind, declaration_kind) = match &export_decl.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(func) => (
                        func.id.as_ref().map(|id| id.name.to_string()),
                        "value",
                        Some("function"),
                    ),
                    ExportDefaultDeclarationKind::ClassDeclaration(class_decl) => (
                        class_decl.id.as_ref().map(|id| id.name.to_string()),
                        "value",
                        Some("class"),
                    ),
                    ExportDefaultDeclarationKind::TSInterfaceDeclaration(interface_decl) => (
                        Some(interface_decl.id.name.to_string()),
                        "type",
                        Some("interface"),
                    ),
                    _ => (None, "value", None),
                };

                exports.push(ExportFactPayload {
                    kind: "default",
                    local: local_name,
                    exported: Some("default".to_string()),
                    source: None,
                    export_kind: Some(export_kind),
                    declaration_kind,
                    span: export_span,
                });
            }
            Statement::ExportAllDeclaration(export_decl) => {
                let export_span = span_converter.convert(export_decl.span);
                exports.push(ExportFactPayload {
                    kind: "all",
                    local: None,
                    exported: None,
                    source: Some(export_decl.source.value.to_string()),
                    export_kind: Some(export_value_kind(export_decl.export_kind)),
                    declaration_kind: None,
                    span: export_span,
                });
            }
            _ => {}
        }
    }

    // 5. JSX Tags
    let mut jsx_tags = Vec::new();
    for node in semantic.nodes().iter() {
        if let oxc_ast::AstKind::JSXOpeningElement(elem) = node.kind() {
            let span = span_converter.convert(elem.span);

            match &elem.name {
                oxc_ast::ast::JSXElementName::Identifier(id) => {
                    let name = id.name.to_string();
                    jsx_tags.push(JsxTagFactPayload {
                        name,
                        kind: "identifier",
                        binding_id: None,
                        span,
                    });
                }
                oxc_ast::ast::JSXElementName::IdentifierReference(id) => {
                    let name = id.name.to_string();
                    let binding_id = binding_id_for_identifier(scoping, id);
                    jsx_tags.push(JsxTagFactPayload {
                        name,
                        kind: "identifier",
                        binding_id,
                        span,
                    });
                }
                oxc_ast::ast::JSXElementName::NamespacedName(ns) => {
                    let name = format!("{}:{}", ns.namespace.name, ns.name.name);
                    jsx_tags.push(JsxTagFactPayload {
                        name,
                        kind: "namespaced",
                        binding_id: None,
                        span,
                    });
                }
                oxc_ast::ast::JSXElementName::MemberExpression(mem) => {
                    let name = get_jsx_member_expr_name(mem);
                    let binding_id = mem
                        .get_identifier()
                        .and_then(|id| binding_id_for_identifier(scoping, id));
                    jsx_tags.push(JsxTagFactPayload {
                        name,
                        kind: "member",
                        binding_id,
                        span,
                    });
                }
                oxc_ast::ast::JSXElementName::ThisExpression(_) => {
                    jsx_tags.push(JsxTagFactPayload {
                        name: "this".to_string(),
                        kind: "identifier",
                        binding_id: None,
                        span,
                    });
                }
            }
        }
    }

    serde_json::to_vec(&AnalyzeSuccessPayload {
        abi_version: ABI_VERSION,
        kind: "analyze",
        ok: true,
        scopes,
        bindings,
        references,
        unresolved,
        imports,
        exports,
        jsx_tags,
        diagnostics: vec![],
    })
    .unwrap()
}

fn diagnostic_payload(filename: &str, diagnostic: &OxcDiagnostic) -> DiagnosticPayload {
    let (start, end) = diagnostic
        .labels
        .first()
        .map(|label| {
            let span = label.inner();
            (Some(span.offset()), Some(span.offset() + span.len()))
        })
        .unwrap_or((None, None));

    DiagnosticPayload {
        severity: if diagnostic.severity == Severity::Warning {
            "warning"
        } else {
            "error"
        },
        message: diagnostic.to_string(),
        file: filename.to_string(),
        start,
        end,
    }
}

unsafe fn read_utf8<'a>(ptr: *const u8, len: usize) -> Option<&'a str> {
    if len == 0 {
        return Some("");
    }
    if ptr.is_null() {
        return None;
    }
    let bytes = unsafe { slice::from_raw_parts(ptr, len) };
    str::from_utf8(bytes).ok()
}

fn source_type_for(filename: &str, options: &AnalyzeOptions) -> SourceType {
    let mut source_type = match options.lang.as_deref() {
        Some("tsx") => SourceType::tsx(),
        Some("ts") => SourceType::ts(),
        Some("jsx") => SourceType::jsx(),
        Some("js") => SourceType::mjs(),
        _ => SourceType::from_path(Path::new(filename)).unwrap_or_else(|_| {
            if filename.ends_with(".tsx") {
                SourceType::tsx()
            } else if filename.ends_with(".ts") {
                SourceType::ts()
            } else if filename.ends_with(".jsx") {
                SourceType::jsx()
            } else {
                SourceType::mjs()
            }
        }),
    };

    source_type = match options.source_type.as_deref() {
        Some("script") => source_type.with_module(false),
        Some("module") => source_type.with_module(true),
        _ => source_type.with_module(true),
    };

    source_type
}

fn store_result(bytes: Vec<u8>) -> u32 {
    RESULTS.with(|results| {
        NEXT_RESULT.with(|next| {
            let mut next = next.borrow_mut();
            let handle = *next;
            *next = next.saturating_add(1).max(1);
            results.borrow_mut().insert(handle, bytes);
            handle
        })
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn result_ptr(handle: u32) -> *const u8 {
    RESULTS.with(|results| {
        results
            .borrow()
            .get(&handle)
            .map_or(std::ptr::null(), |bytes| bytes.as_ptr())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn result_len(handle: u32) -> usize {
    RESULTS.with(|results| results.borrow().get(&handle).map_or(0, Vec::len))
}

#[unsafe(no_mangle)]
pub extern "C" fn free_result(handle: u32) {
    RESULTS.with(|results| {
        results.borrow_mut().remove(&handle);
    });
}

fn binding_id_for_identifier(
    scoping: &oxc_semantic::Scoping,
    id: &oxc_ast::ast::IdentifierReference<'_>,
) -> Option<usize> {
    id.reference_id
        .get()
        .and_then(|reference_id| scoping.get_reference(reference_id).symbol_id())
        .map(|symbol_id| symbol_id.index())
}

fn get_jsx_member_expr_name(mem: &oxc_ast::ast::JSXMemberExpression<'_>) -> String {
    let obj_name = match &mem.object {
        oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(id) => id.name.to_string(),
        oxc_ast::ast::JSXMemberExpressionObject::MemberExpression(inner) => {
            get_jsx_member_expr_name(inner)
        }
        _ => "unknown".to_string(),
    };
    format!("{}.{}", obj_name, mem.property.name)
}
