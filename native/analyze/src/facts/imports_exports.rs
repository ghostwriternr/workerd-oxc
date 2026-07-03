use super::{FactContext, variable_declaration_kind};
use crate::payload::{ExportFactPayload, ImportFactPayload, SpanPayload};
use oxc_ast::ast::{
    BindingIdentifier, BindingPattern, Declaration, ExportDefaultDeclarationKind,
    ImportDeclarationSpecifier, ImportOrExportKind, ModuleExportName, Statement,
};

pub(crate) fn collect_imports_exports(
    ctx: &mut FactContext<'_, '_>,
) -> (Vec<ImportFactPayload>, Vec<ExportFactPayload>) {
    let mut imports = Vec::new();
    let mut exports = Vec::new();

    for stmt in &ctx.program.body {
        match stmt {
            Statement::ImportDeclaration(import_decl) => {
                let source_str = import_decl.source.value.to_string();
                let source_span = ctx.spans.convert(import_decl.source.span);
                let is_type_decl = import_decl.import_kind.is_type();

                if let Some(specifiers) = &import_decl.specifiers {
                    for specifier in specifiers {
                        let (binding_id, local, imported, specifier_kind, span, spec_is_type) =
                            match specifier {
                                ImportDeclarationSpecifier::ImportSpecifier(spec) => {
                                    let binding_id = import_binding_id(&spec.local);
                                    let local = spec.local.name.to_string();
                                    let imported =
                                        Some(module_export_name_to_string(&spec.imported));
                                    let span = ctx.spans.convert(spec.span);
                                    let is_type = is_type_decl || spec.import_kind.is_type();
                                    (binding_id, local, imported, "named", span, is_type)
                                }
                                ImportDeclarationSpecifier::ImportDefaultSpecifier(spec) => {
                                    let binding_id = import_binding_id(&spec.local);
                                    let local = spec.local.name.to_string();
                                    let span = ctx.spans.convert(spec.span);
                                    (binding_id, local, None, "default", span, is_type_decl)
                                }
                                ImportDeclarationSpecifier::ImportNamespaceSpecifier(spec) => {
                                    let binding_id = import_binding_id(&spec.local);
                                    let local = spec.local.name.to_string();
                                    let span = ctx.spans.convert(spec.span);
                                    (binding_id, local, None, "namespace", span, is_type_decl)
                                }
                            };
                        let kind = if spec_is_type { "type" } else { "value" };

                        imports.push(ImportFactPayload {
                            binding_id,
                            source: source_str.clone(),
                            local,
                            specifier_kind,
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
                let export_span = ctx.spans.convert(export_decl.span);

                if let Some(decl) = &export_decl.declaration {
                    match decl {
                        Declaration::FunctionDeclaration(func) => {
                            if let Some(id) = &func.id {
                                push_named_export(
                                    &mut exports,
                                    id.name.to_string(),
                                    source_str.clone(),
                                    Some("value"),
                                    Some("function"),
                                    export_span,
                                );
                            }
                        }
                        Declaration::ClassDeclaration(class_decl) => {
                            if let Some(id) = &class_decl.id {
                                push_named_export(
                                    &mut exports,
                                    id.name.to_string(),
                                    source_str.clone(),
                                    Some("value"),
                                    Some("class"),
                                    export_span,
                                );
                            }
                        }
                        Declaration::VariableDeclaration(var_decl) => {
                            let declaration_kind = variable_declaration_kind(var_decl.kind);
                            for declarator in &var_decl.declarations {
                                let mut names = Vec::new();
                                binding_pattern_names(&declarator.id, &mut names);
                                for name in names {
                                    push_named_export(
                                        &mut exports,
                                        name,
                                        source_str.clone(),
                                        Some("value"),
                                        Some(declaration_kind),
                                        export_span,
                                    );
                                }
                            }
                        }
                        Declaration::TSTypeAliasDeclaration(type_decl) => {
                            push_named_export(
                                &mut exports,
                                type_decl.id.name.to_string(),
                                source_str.clone(),
                                Some("type"),
                                Some("type"),
                                export_span,
                            );
                        }
                        Declaration::TSInterfaceDeclaration(interface_decl) => {
                            push_named_export(
                                &mut exports,
                                interface_decl.id.name.to_string(),
                                source_str.clone(),
                                Some("type"),
                                Some("interface"),
                                export_span,
                            );
                        }
                        Declaration::TSEnumDeclaration(enum_decl) => {
                            push_named_export(
                                &mut exports,
                                enum_decl.id.name.to_string(),
                                source_str.clone(),
                                Some("value"),
                                Some("enum"),
                                export_span,
                            );
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
                        span: ctx.spans.convert(spec.span),
                    });
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                let export_span = ctx.spans.convert(export_decl.span);
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
                let export_span = ctx.spans.convert(export_decl.span);
                exports.push(ExportFactPayload {
                    kind: "all",
                    local: None,
                    exported: export_decl
                        .exported
                        .as_ref()
                        .map(module_export_name_to_string),
                    source: Some(export_decl.source.value.to_string()),
                    export_kind: Some(export_value_kind(export_decl.export_kind)),
                    declaration_kind: None,
                    span: export_span,
                });
            }
            _ => {}
        }
    }

    (imports, exports)
}

fn import_binding_id(local: &BindingIdentifier<'_>) -> usize {
    local
        .symbol_id
        .get()
        .expect("semantic analysis should assign symbol ids to import bindings")
        .index()
}

fn push_named_export(
    exports: &mut Vec<ExportFactPayload>,
    name: String,
    source: Option<String>,
    export_kind: Option<&'static str>,
    declaration_kind: Option<&'static str>,
    span: SpanPayload,
) {
    exports.push(ExportFactPayload {
        kind: "named",
        local: Some(name.clone()),
        exported: Some(name),
        source,
        export_kind,
        declaration_kind,
        span,
    });
}

fn binding_pattern_names(pattern: &BindingPattern<'_>, names: &mut Vec<String>) {
    match pattern {
        BindingPattern::BindingIdentifier(id) => names.push(id.name.to_string()),
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                binding_pattern_names(&property.value, names);
            }
            if let Some(rest) = &object.rest {
                binding_pattern_names(&rest.argument, names);
            }
        }
        BindingPattern::ArrayPattern(array) => {
            for element in array.elements.iter().flatten() {
                binding_pattern_names(element, names);
            }
            if let Some(rest) = &array.rest {
                binding_pattern_names(&rest.argument, names);
            }
        }
        BindingPattern::AssignmentPattern(assignment) => {
            binding_pattern_names(&assignment.left, names);
        }
    }
}

fn export_value_kind(kind: ImportOrExportKind) -> &'static str {
    if kind.is_type() { "type" } else { "value" }
}

fn module_export_name_to_string(name: &ModuleExportName<'_>) -> String {
    match name {
        ModuleExportName::IdentifierName(id) => id.name.to_string(),
        ModuleExportName::IdentifierReference(id) => id.name.to_string(),
        ModuleExportName::StringLiteral(str) => str.value.to_string(),
    }
}
