use std::path::Path;

use oxc_ast_visit::utf8_to_utf16::{Utf8ToUtf16, Utf8ToUtf16Converter};
use oxc_span::{SourceType, Span};
use serde::Deserialize;

use crate::payload::SpanPayload;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalyzeOptions {
    pub(crate) lang: Option<String>,
    pub(crate) source_type: Option<String>,
}

pub(crate) struct SpanConverter<'a> {
    converter: Option<Utf8ToUtf16Converter<'a>>,
}

impl<'a> SpanConverter<'a> {
    pub(crate) fn new(table: &'a Utf8ToUtf16) -> Self {
        Self {
            converter: table.converter(),
        }
    }

    pub(crate) fn convert(&mut self, span: Span) -> SpanPayload {
        let mut start = span.start;
        let mut end = span.end;
        if let Some(ref mut conv) = self.converter {
            conv.convert_offset(&mut start);
            conv.convert_offset(&mut end);
        }
        SpanPayload { start, end }
    }
}

pub(crate) fn source_type_for(filename: &str, options: &AnalyzeOptions) -> SourceType {
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
