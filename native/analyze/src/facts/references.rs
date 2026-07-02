use super::FactContext;
use crate::payload::ReferenceFactPayload;

pub(crate) fn collect_references(
    ctx: &mut FactContext<'_, '_>,
) -> (Vec<ReferenceFactPayload>, Vec<ReferenceFactPayload>) {
    let mut references = Vec::new();
    let mut unresolved = Vec::new();

    for id in 0..ctx.scoping.references_len() {
        let reference_id = oxc_semantic::ReferenceId::from(id);
        let reference = ctx.scoping.get_reference(reference_id);
        let name = ctx.semantic.reference_name(reference).to_string();

        let flags_val = reference.flags();
        let mut flags = Vec::new();
        if flags_val.is_read() {
            flags.push("read");
        }
        if flags_val.is_write() {
            flags.push("write");
        }
        let kind = if flags_val.is_type() {
            "type"
        } else {
            "identifier"
        };

        let scope_id = reference.scope_id().index();
        let binding_id = reference.symbol_id().map(|sid| sid.index());
        let span = ctx.spans.convert(ctx.semantic.reference_span(reference));

        let payload = ReferenceFactPayload {
            id,
            name,
            kind,
            flags,
            scope_id,
            binding_id,
            span,
        };

        if binding_id.is_none() {
            unresolved.push(payload.clone());
        }
        references.push(payload);
    }

    (references, unresolved)
}
