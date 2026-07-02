use oxc_diagnostics::{OxcDiagnostic, Severity};

use crate::payload::DiagnosticPayload;

pub(crate) fn diagnostic_payload(filename: &str, diagnostic: &OxcDiagnostic) -> DiagnosticPayload {
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

pub(crate) fn diagnostic_payloads(
    filename: &str,
    diagnostics: &[OxcDiagnostic],
) -> Vec<DiagnosticPayload> {
    diagnostics
        .iter()
        .map(|diagnostic| diagnostic_payload(filename, diagnostic))
        .collect()
}

pub(crate) fn has_error_diagnostic(diagnostics: &[OxcDiagnostic]) -> bool {
    diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == Severity::Error)
}
