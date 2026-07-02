use oxc_span::GetSpan;
use oxc_syntax::scope::ScopeFlags;

use super::FactContext;
use crate::payload::ScopeFactPayload;

pub(crate) fn collect_scopes(ctx: &mut FactContext<'_, '_>) -> Vec<ScopeFactPayload> {
    let mut scopes = Vec::new();
    for scope_id in ctx.scoping.scope_descendants_from_root() {
        let node_id = ctx.scoping.get_node_id(scope_id);
        let node = ctx.semantic.nodes().get_node(node_id);
        scopes.push(ScopeFactPayload {
            id: scope_id.index(),
            parent_id: ctx.scoping.scope_parent_id(scope_id).map(|id| id.index()),
            kind: scope_kind(ctx.scoping.scope_flags(scope_id)),
            span: Some(ctx.spans.convert(node.span())),
        });
    }
    scopes
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
