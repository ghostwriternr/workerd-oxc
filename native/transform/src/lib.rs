use std::{ops::ControlFlow, path::Path};

use oxc::{
    CompilerInterface,
    codegen::CodegenReturn,
    diagnostics::{Diagnostics, OxcDiagnostic, Severity},
    span::SourceType,
    transformer::{JsxOptions, JsxRuntime, TransformOptions as OxcTransformOptions},
};
use serde::{Deserialize, Serialize};
use workerd_oxc_abi::{ABI_VERSION, read_utf8, store_result};

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TransformOptionsInput {
    lang: Option<String>,
    source_type: Option<String>,
    jsx: Option<JsxInput>,
    target: Option<String>,
    sourcemap: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum JsxInput {
    String(String),
    Object(JsxObjectInput),
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct JsxObjectInput {
    runtime: Option<String>,
    import_source: Option<String>,
    development: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransformPayload {
    abi_version: u32,
    kind: &'static str,
    ok: bool,
    code: String,
    map: Option<serde_json::Value>,
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

#[derive(Default)]
struct DirectCompiler {
    transform_options: OxcTransformOptions,
    sourcemap: bool,
    printed: String,
    printed_sourcemap: Option<serde_json::Value>,
    diagnostics: Diagnostics,
}

impl DirectCompiler {
    fn new(options: &TransformOptionsInput) -> Result<Self, String> {
        let target = options.target.as_deref().unwrap_or("es2022");
        let mut transform_options = OxcTransformOptions::from_target(target)?;
        transform_options.jsx = jsx_options(options.jsx.as_ref());

        Ok(Self {
            transform_options,
            sourcemap: options.sourcemap.unwrap_or(true),
            printed: String::new(),
            printed_sourcemap: None,
            diagnostics: Diagnostics::new(),
        })
    }
}

impl CompilerInterface for DirectCompiler {
    fn handle_errors(&mut self, errors: Diagnostics) {
        self.diagnostics.extend(errors);
    }

    fn enable_sourcemap(&self) -> bool {
        self.sourcemap
    }

    fn transform_options(&self) -> Option<&OxcTransformOptions> {
        Some(&self.transform_options)
    }

    fn after_codegen(&mut self, ret: CodegenReturn<'_>) {
        self.printed = ret.code;
        self.printed_sourcemap = ret.map.map(|map| {
            serde_json::from_str(&map.to_json_string()).unwrap_or(serde_json::Value::Null)
        });
    }

    fn after_transform(
        &mut self,
        _program: &mut oxc::ast::ast::Program<'_>,
        _transformer_return: &mut oxc::transformer::TransformerReturn,
    ) -> ControlFlow<()> {
        ControlFlow::Continue(())
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn transform(
    filename_ptr: *const u8,
    filename_len: usize,
    source_ptr: *const u8,
    source_len: usize,
    options_ptr: *const u8,
    options_len: usize,
) -> u32 {
    store_result(unsafe {
        transform_inner(
            filename_ptr,
            filename_len,
            source_ptr,
            source_len,
            options_ptr,
            options_len,
        )
    })
}

unsafe fn transform_inner(
    filename_ptr: *const u8,
    filename_len: usize,
    source_ptr: *const u8,
    source_len: usize,
    options_ptr: *const u8,
    options_len: usize,
) -> Vec<u8> {
    let filename = unsafe { read_utf8(filename_ptr, filename_len) }.unwrap_or("<unknown>");
    let source = unsafe { read_utf8(source_ptr, source_len) }.unwrap_or("");
    let options = match unsafe { read_utf8(options_ptr, options_len) }
        .and_then(|json| serde_json::from_str::<TransformOptionsInput>(json).ok())
    {
        Some(options) => options,
        None => TransformOptionsInput::default(),
    };

    let source_type = source_type_for(filename, &options);
    let source_path = Path::new(filename);
    let mut compiler = match DirectCompiler::new(&options) {
        Ok(compiler) => compiler,
        Err(error) => {
            return failure_payload(
                filename,
                "",
                None,
                vec![DiagnosticPayload {
                    severity: "error",
                    message: error,
                    file: filename.to_string(),
                    start: None,
                    end: None,
                }],
            );
        }
    };

    compiler.compile(source, source_type, source_path);
    let diagnostics = diagnostics_payload(filename, &compiler.diagnostics);
    if compiler.diagnostics.has_errors() {
        return failure_payload(
            filename,
            &compiler.printed,
            compiler.printed_sourcemap,
            diagnostics,
        );
    }

    serde_json::to_vec(&TransformPayload {
        abi_version: ABI_VERSION,
        kind: "transform",
        ok: true,
        code: compiler.printed,
        map: compiler.printed_sourcemap,
        diagnostics,
    })
    .unwrap()
}

fn failure_payload(
    _filename: &str,
    code: &str,
    map: Option<serde_json::Value>,
    diagnostics: Vec<DiagnosticPayload>,
) -> Vec<u8> {
    serde_json::to_vec(&TransformPayload {
        abi_version: ABI_VERSION,
        kind: "transform",
        ok: false,
        code: code.to_string(),
        map,
        diagnostics,
    })
    .unwrap()
}

fn jsx_options(input: Option<&JsxInput>) -> JsxOptions {
    let mut options = match input {
        Some(JsxInput::String(value)) if value == "preserve" => JsxOptions::disable(),
        Some(JsxInput::String(value)) if value == "classic" => {
            let mut options = JsxOptions::enable();
            options.runtime = JsxRuntime::Classic;
            options
        }
        Some(JsxInput::Object(value)) => {
            let mut options = JsxOptions::enable();
            if value.runtime.as_deref() == Some("classic") {
                options.runtime = JsxRuntime::Classic;
            } else {
                options.runtime = JsxRuntime::Automatic;
            }
            options.import_source = value.import_source.clone();
            options.development = value.development.unwrap_or(false);
            options
        }
        _ => JsxOptions::enable(),
    };
    options.conform();
    options
}

fn source_type_for(filename: &str, options: &TransformOptionsInput) -> SourceType {
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

fn diagnostics_payload(filename: &str, diagnostics: &Diagnostics) -> Vec<DiagnosticPayload> {
    diagnostics
        .iter()
        .map(|diagnostic| diagnostic_payload(filename, diagnostic))
        .collect()
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
