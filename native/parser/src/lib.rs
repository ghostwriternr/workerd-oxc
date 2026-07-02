use std::path::Path;

use oxc_allocator::Allocator;
use oxc_ast_visit::utf8_to_utf16::Utf8ToUtf16;
use oxc_diagnostics::{OxcDiagnostic, Severity};
use oxc_parser::{ParseOptions as OxcParseOptions, Parser};
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};
use workerd_oxc_abi::{ABI_VERSION, read_utf8, store_result};

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ParseOptions {
    lang: Option<String>,
    source_type: Option<String>,
    ast_type: Option<String>,
    range: Option<bool>,
    preserve_parens: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParseFailurePayload {
    abi_version: u32,
    kind: &'static str,
    ok: bool,
    raw_program_length: usize,
    payload: Option<serde_json::Value>,
    diagnostics: Vec<DiagnosticPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticPayload {
    severity: &'static str,
    message: String,
    file: String,
    start: Option<u32>,
    end: Option<u32>,
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn parse(
    filename_ptr: *const u8,
    filename_len: usize,
    source_ptr: *const u8,
    source_len: usize,
    options_ptr: *const u8,
    options_len: usize,
) -> u32 {
    store_result(unsafe {
        parse_inner(
            filename_ptr,
            filename_len,
            source_ptr,
            source_len,
            options_ptr,
            options_len,
        )
    })
}

unsafe fn parse_inner(
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
        .and_then(|json| serde_json::from_str::<ParseOptions>(json).ok())
        .unwrap_or_default();

    let allocator = Allocator::default();
    let source_type = source_type_for(filename, &options);
    let mut parse_options = OxcParseOptions::default();
    if let Some(preserve_parens) = options.preserve_parens {
        parse_options.preserve_parens = preserve_parens;
    }

    let parser_return = Parser::new(&allocator, source, source_type)
        .with_options(parse_options)
        .parse();

    let mut program = parser_return.program;
    let mut module_record = parser_return.module_record;
    let diagnostics = parser_return.diagnostics;

    let diagnostic_payloads = diagnostics
        .iter()
        .map(|diagnostic| diagnostic_payload(filename, diagnostic))
        .collect::<Vec<_>>();

    let converter = Utf8ToUtf16::new(source);
    converter.convert_program(&mut program);
    converter.convert_module_record(&mut module_record);

    let include_ts_fields = options.ast_type.as_deref().unwrap_or_else(|| {
        if source_type.is_typescript() {
            "ts"
        } else {
            "js"
        }
    }) == "ts";
    let ranges = options.range.unwrap_or(false);
    let raw_program = program.to_estree_json_with_fixes(include_ts_fields, ranges);
    let raw_program_length = raw_program.len();

    if diagnostic_payloads.is_empty() {
        success_payload(raw_program, raw_program_length)
    } else {
        serde_json::to_vec(&ParseFailurePayload {
            abi_version: ABI_VERSION,
            kind: "parse",
            ok: false,
            raw_program_length,
            payload: None,
            diagnostics: diagnostic_payloads,
        })
        .unwrap()
    }
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

fn success_payload(raw_program: String, raw_program_length: usize) -> Vec<u8> {
    let mut json = String::with_capacity(raw_program.len() + 128);
    json.push_str("{\"abiVersion\":");
    json.push_str(&ABI_VERSION.to_string());
    json.push_str(",\"kind\":\"parse\",\"ok\":true,\"rawProgramLength\":");
    json.push_str(&raw_program_length.to_string());
    json.push_str(",\"payload\":");
    json.push_str(&raw_program);
    json.push_str(",\"diagnostics\":[]}");
    json.into_bytes()
}

fn source_type_for(filename: &str, options: &ParseOptions) -> SourceType {
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
