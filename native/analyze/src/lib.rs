use oxc_allocator::Allocator;
use oxc_ast_visit::utf8_to_utf16::Utf8ToUtf16;
use oxc_parser::{ParseOptions as OxcParseOptions, Parser};
use oxc_semantic::SemanticBuilder;

use crate::{
    diagnostics::{diagnostic_payloads, has_error_diagnostic},
    facts::{FactContext, collect_facts},
    payload::{AnalyzeFailurePayload, AnalyzeSuccessPayload},
    source::{AnalyzeOptions, SpanConverter, source_type_for},
};
use workerd_oxc_abi::{ABI_VERSION, read_utf8, store_result};

mod diagnostics;
mod facts;
mod payload;
mod source;

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

    let parser_return = Parser::new(&allocator, source, source_type)
        .with_options(OxcParseOptions::default())
        .parse();

    let mut parse_diagnostics = parser_return.diagnostics;
    let program = parser_return.program;

    let semantic_return = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&program);

    let semantic = semantic_return.semantic;
    let mut semantic_diagnostics = semantic_return.diagnostics;

    let has_errors = !parse_diagnostics.is_empty() || has_error_diagnostic(&semantic_diagnostics);
    if has_errors {
        parse_diagnostics.append(&mut semantic_diagnostics);
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
            diagnostics: diagnostic_payloads(filename, &parse_diagnostics),
        })
        .unwrap();
    }

    let scoping = semantic.scoping();
    let mut fact_context = FactContext {
        program: &program,
        semantic: &semantic,
        scoping,
        spans: &mut span_converter,
    };
    let facts = collect_facts(&mut fact_context);

    serde_json::to_vec(&AnalyzeSuccessPayload {
        abi_version: ABI_VERSION,
        kind: "analyze",
        ok: true,
        scopes: facts.scopes,
        bindings: facts.bindings,
        references: facts.references,
        unresolved: facts.unresolved,
        imports: facts.imports,
        exports: facts.exports,
        jsx_tags: facts.jsx_tags,
        diagnostics: diagnostic_payloads(filename, &semantic_diagnostics),
    })
    .unwrap()
}
