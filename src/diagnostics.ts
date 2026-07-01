import type { SourceSpan, ToolName, ToolchainDiagnostic, ToolchainEvidence } from "./types";

export interface SourceLocation {
  line: number;
  column: number;
}

export function diagnostic(
  tool: ToolName,
  kind: ToolchainDiagnostic["kind"],
  message: string,
  cause?: unknown
): ToolchainDiagnostic {
  return {
    tool,
    kind,
    severity: kind === "warning" || kind === "not-applicable" ? "warning" : "error",
    message,
    cause: stringifyCause(cause)
  };
}

export function diagnosticAtSourceOffset(
  tool: ToolName,
  kind: ToolchainDiagnostic["kind"],
  message: string,
  options: {
    source: string;
    offset: number;
    end?: number;
    file?: string;
    cause?: unknown;
  }
): ToolchainDiagnostic {
  const location = sourceLocationAtOffset(options.source, options.offset);
  const span = sourceSpan(options.source, options.offset, options.end);
  return {
    ...diagnostic(tool, kind, message, options.cause),
    file: options.file,
    line: location.line,
    column: location.column,
    span
  };
}

export function sourceLocationAtOffset(source: string, offset: number): SourceLocation {
  const clampedOffset = clampOffset(source, offset);
  let line = 1;
  let lineStart = 0;

  for (let index = 0; index < clampedOffset; index++) {
    if (source[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }

  return { line, column: clampedOffset - lineStart + 1 };
}

function sourceSpan(source: string, start: number, end = start): SourceSpan {
  const clampedStart = clampOffset(source, start);
  const clampedEnd = clampOffset(source, end);
  return clampedStart <= clampedEnd
    ? { start: clampedStart, end: clampedEnd }
    : { start: clampedEnd, end: clampedStart };
}

function clampOffset(source: string, offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(Math.trunc(offset), 0), source.length);
}

export function evidence(
  tool: ToolName,
  stage: ToolchainEvidence["stage"],
  ok: boolean,
  started: number,
  detail?: string
): ToolchainEvidence {
  return { tool, stage, ok, durationMs: Math.round(performance.now() - started), detail };
}

export function stringifyCause(cause: unknown): string | undefined {
  if (cause === undefined) return undefined;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

export function isProbablyWorkerd(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}
