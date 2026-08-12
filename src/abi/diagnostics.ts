import { sourceLocationAtOffset, sourceSpan, stringifyCause } from "../diagnostics.ts";
import type { OxcDiagnostic } from "../types.ts";
import { byteOffsetToStringOffset } from "./utf8.ts";

export interface NativeDiagnosticLike {
  severity?: unknown;
  message?: unknown;
  file?: unknown;
  start?: unknown;
  end?: unknown;
  labels?: unknown;
}

export function normalizeNativeDiagnostic(input: {
  filename: string;
  source: string;
  phase: OxcDiagnostic["phase"];
  offsetEncoding?: "utf8" | "utf16";
  value: unknown;
}): OxcDiagnostic {
  const direct = input.value as NativeDiagnosticLike;
  const label = Array.isArray(direct.labels)
    ? (direct.labels[0] as NativeDiagnosticLike)
    : undefined;
  const rawStart = typeof direct.start === "number" ? direct.start : label?.start;
  const rawEnd = typeof direct.end === "number" ? direct.end : label?.end;
  const start =
    typeof rawStart === "number"
      ? input.offsetEncoding === "utf16"
        ? rawStart
        : byteOffsetToStringOffset(input.source, rawStart)
      : undefined;
  const end =
    typeof rawEnd === "number"
      ? input.offsetEncoding === "utf16"
        ? rawEnd
        : byteOffsetToStringOffset(input.source, rawEnd)
      : undefined;
  const location = start === undefined ? undefined : sourceLocationAtOffset(input.source, start);

  return {
    phase: input.phase,
    severity: direct.severity === "warning" || direct.severity === "Warning" ? "warning" : "error",
    message: typeof direct.message === "string" ? direct.message : String(input.value),
    filename:
      typeof direct.file === "string" && direct.file.length > 0 ? direct.file : input.filename,
    location,
    span:
      start !== undefined && end !== undefined ? sourceSpan(input.source, start, end) : undefined,
    cause: stringifyCause(input.value),
  };
}

export function collectArrayLike(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
