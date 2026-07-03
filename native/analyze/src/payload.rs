use serde::Serialize;

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpanPayload {
    pub(crate) start: u32,
    pub(crate) end: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScopeFactPayload {
    pub(crate) id: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) parent_id: Option<usize>,
    pub(crate) kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) span: Option<SpanPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BindingFactPayload {
    pub(crate) id: usize,
    pub(crate) name: String,
    pub(crate) kind: &'static str,
    pub(crate) flags: Vec<&'static str>,
    pub(crate) scope_id: usize,
    pub(crate) span: SpanPayload,
    pub(crate) references: Vec<usize>,
    pub(crate) mutated: bool,
    pub(crate) unused: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReferenceFactPayload {
    pub(crate) id: usize,
    pub(crate) name: String,
    pub(crate) kind: &'static str,
    pub(crate) flags: Vec<&'static str>,
    pub(crate) scope_id: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) binding_id: Option<usize>,
    pub(crate) span: SpanPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportFactPayload {
    pub(crate) source: String,
    pub(crate) local: String,
    pub(crate) specifier_kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) imported: Option<String>,
    pub(crate) kind: &'static str,
    pub(crate) span: SpanPayload,
    pub(crate) source_span: SpanPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportFactPayload {
    pub(crate) kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) local: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) exported: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) export_kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) declaration_kind: Option<&'static str>,
    pub(crate) span: SpanPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JsxTagFactPayload {
    pub(crate) id: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) parent_id: Option<usize>,
    pub(crate) name: String,
    pub(crate) kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) binding_id: Option<usize>,
    pub(crate) span: SpanPayload,
    pub(crate) name_span: SpanPayload,
    pub(crate) element_span: SpanPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) closing_span: Option<SpanPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) closing_name_span: Option<SpanPayload>,
    pub(crate) self_closing: bool,
    pub(crate) attributes: Vec<JsxAttributeFactPayload>,
    pub(crate) children: Vec<JsxChildFactPayload>,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum JsxAttributeFactPayload {
    #[serde(rename = "attribute")]
    Attribute {
        name: String,
        name_span: SpanPayload,
        span: SpanPayload,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<JsxAttributeValueFactPayload>,
    },
    #[serde(rename = "spread")]
    Spread {
        span: SpanPayload,
        expression_span: SpanPayload,
    },
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum JsxAttributeValueFactPayload {
    #[serde(rename = "string")]
    String { value: String, span: SpanPayload },
    #[serde(rename = "expression")]
    Expression {
        span: SpanPayload,
        #[serde(skip_serializing_if = "Option::is_none")]
        expression_span: Option<SpanPayload>,
        #[serde(skip_serializing_if = "Option::is_none")]
        literal: Option<LiteralValueFactPayload>,
    },
    #[serde(rename = "element")]
    Element { span: SpanPayload, tag_id: usize },
    #[serde(rename = "fragment")]
    Fragment { span: SpanPayload },
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum LiteralValueFactPayload {
    String {
        value: String,
    },
    Number {
        value: f64,
    },
    Boolean {
        value: bool,
    },
    Null,
    Array {
        elements: Vec<LiteralValueFactPayload>,
    },
    Object {
        properties: Vec<LiteralPropertyFactPayload>,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiteralPropertyFactPayload {
    pub(crate) key: String,
    pub(crate) value: LiteralValueFactPayload,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum JsxChildFactPayload {
    #[serde(rename = "text")]
    Text {
        span: SpanPayload,
        raw: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    #[serde(rename = "element")]
    Element { span: SpanPayload, tag_id: usize },
    #[serde(rename = "fragment")]
    Fragment {
        span: SpanPayload,
        children: Vec<JsxChildFactPayload>,
    },
    #[serde(rename = "expression")]
    Expression {
        span: SpanPayload,
        #[serde(skip_serializing_if = "Option::is_none")]
        expression_span: Option<SpanPayload>,
        #[serde(skip_serializing_if = "Option::is_none")]
        literal: Option<LiteralValueFactPayload>,
    },
    #[serde(rename = "spread")]
    Spread {
        span: SpanPayload,
        expression_span: SpanPayload,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalyzeSuccessPayload {
    pub(crate) abi_version: u32,
    pub(crate) kind: &'static str,
    pub(crate) ok: bool,
    pub(crate) scopes: Vec<ScopeFactPayload>,
    pub(crate) bindings: Vec<BindingFactPayload>,
    pub(crate) references: Vec<ReferenceFactPayload>,
    pub(crate) unresolved: Vec<ReferenceFactPayload>,
    pub(crate) imports: Vec<ImportFactPayload>,
    pub(crate) exports: Vec<ExportFactPayload>,
    pub(crate) jsx_tags: Vec<JsxTagFactPayload>,
    pub(crate) diagnostics: Vec<DiagnosticPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalyzeFailurePayload {
    pub(crate) abi_version: u32,
    pub(crate) kind: &'static str,
    pub(crate) ok: bool,
    pub(crate) scopes: Vec<serde_json::Value>,
    pub(crate) bindings: Vec<serde_json::Value>,
    pub(crate) references: Vec<serde_json::Value>,
    pub(crate) unresolved: Vec<serde_json::Value>,
    pub(crate) imports: Vec<serde_json::Value>,
    pub(crate) exports: Vec<serde_json::Value>,
    pub(crate) jsx_tags: Vec<serde_json::Value>,
    pub(crate) diagnostics: Vec<DiagnosticPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticPayload {
    pub(crate) severity: &'static str,
    pub(crate) message: String,
    pub(crate) file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) end: Option<u32>,
}
