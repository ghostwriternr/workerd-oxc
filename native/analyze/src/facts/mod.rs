use oxc_ast::ast::Program;
use oxc_semantic::{Scoping, Semantic};

use crate::{
    payload::{
        BindingFactPayload, ExportFactPayload, ImportFactPayload, JsxTagFactPayload,
        ReferenceFactPayload, ScopeFactPayload,
    },
    source::SpanConverter,
};

mod bindings;
mod imports_exports;
mod jsx;
mod references;
mod scopes;

pub(crate) use bindings::variable_declaration_kind;

pub(crate) struct FactContext<'a, 'b> {
    pub(crate) program: &'a Program<'a>,
    pub(crate) semantic: &'a Semantic<'a>,
    pub(crate) scoping: &'a Scoping,
    pub(crate) spans: &'b mut SpanConverter<'a>,
}

pub(crate) struct AnalyzeFacts {
    pub(crate) scopes: Vec<ScopeFactPayload>,
    pub(crate) bindings: Vec<BindingFactPayload>,
    pub(crate) references: Vec<ReferenceFactPayload>,
    pub(crate) unresolved: Vec<ReferenceFactPayload>,
    pub(crate) imports: Vec<ImportFactPayload>,
    pub(crate) exports: Vec<ExportFactPayload>,
    pub(crate) jsx_tags: Vec<JsxTagFactPayload>,
}

pub(crate) fn collect_facts(ctx: &mut FactContext<'_, '_>) -> AnalyzeFacts {
    let scopes = scopes::collect_scopes(ctx);
    let bindings = bindings::collect_bindings(ctx);
    let (references, unresolved) = references::collect_references(ctx);
    let (imports, exports) = imports_exports::collect_imports_exports(ctx);
    let jsx_tags = jsx::collect_jsx_tags(ctx);

    AnalyzeFacts {
        scopes,
        bindings,
        references,
        unresolved,
        imports,
        exports,
        jsx_tags,
    }
}
