import { sourceLocationAtOffset, sourceSpan, stringifyCause } from "../diagnostics.ts";
import type { OxcDiagnostic } from "../types.ts";
import { byteOffsetToStringOffset } from "./utf8.ts";

export interface NativeDiagnosticLike {
  severity?: unknown;
  message?: unknown;
  file?: unknown;
  start?: unknown;
  end?: unknown;
}

export function normalizeNativeDiagnostic(input: {
  filename: string;
  source: string;
  phase: OxcDiagnostic["phase"];
  value: unknown;
}): OxcDiagnostic {
  const direct = input.value as NativeDiagnosticLike;
  const start =
    typeof direct.start === "number"
      ? byteOffsetToStringOffset(input.source, direct.start)
      : undefined;
  const end =
    typeof direct.end === "number" ? byteOffsetToStringOffset(input.source, direct.end) : undefined;
  const location = start === undefined ? undefined : sourceLocationAtOffset(input.source, start);

  return {
    phase: input.phase,
    severity: direct.severity === "warning" ? "warning" : "error",
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
