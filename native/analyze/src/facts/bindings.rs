use oxc_ast::{AstKind, ast::VariableDeclarationKind};
use oxc_syntax::symbol::{SymbolFlags, SymbolId};

use super::FactContext;
use crate::payload::BindingFactPayload;

pub(crate) fn collect_bindings(ctx: &mut FactContext<'_, '_>) -> Vec<BindingFactPayload> {
    let mut bindings = Vec::new();
    for symbol_id in ctx.scoping.symbol_ids() {
        let name = ctx.scoping.symbol_name(symbol_id).to_string();
        let declaration_kind = declaration_kind_for_symbol(ctx.semantic, symbol_id);
        let kind = binding_kind(ctx.scoping.symbol_flags(symbol_id), declaration_kind);
        let flags = symbol_flags(ctx.scoping.symbol_flags(symbol_id));
        let scope_id = ctx.scoping.symbol_scope_id(symbol_id).index();
        let span = ctx.spans.convert(ctx.scoping.symbol_span(symbol_id));
        let references = ctx
            .scoping
            .get_resolved_reference_ids(symbol_id)
            .iter()
            .map(|id| id.index())
            .collect();
        let mutated = ctx.scoping.symbol_is_mutated(symbol_id);
        let unused = ctx.scoping.symbol_is_unused(symbol_id);

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
    bindings
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

pub(crate) fn variable_declaration_kind(kind: VariableDeclarationKind) -> &'static str {
    match kind {
        VariableDeclarationKind::Const => "const",
        VariableDeclarationKind::Let => "let",
        VariableDeclarationKind::Var => "var",
        VariableDeclarationKind::Using | VariableDeclarationKind::AwaitUsing => "const",
    }
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
