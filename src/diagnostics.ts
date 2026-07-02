import type { OxcDiagnostic, OxcSourceLocation, OxcSourceSpan } from "./types.ts";

export function runtimeDiagnostic(phase: "parse" | "transform" | "runtime", message: string, cause?: unknown): OxcDiagnostic {
  return {
    phase,
    severity: "error",
    message,
    cause: stringifyCause(cause),
  };
}

export function sourceLocationAtOffset(source: string, offset: number): OxcSourceLocation {
  const clampedOffset = clampOffset(source, offset);
  let line = 1;
  let lineStart = 0;

  for (let index = 0; index < clampedOffset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }

  return { line, column: clampedOffset - lineStart + 1 };
}

export function sourceSpan(source: string, start: number, end = start): OxcSourceSpan {
  const clampedStart = clampOffset(source, start);
  const clampedEnd = clampOffset(source, end);
  return clampedStart <= clampedEnd
    ? { start: clampedStart, end: clampedEnd }
    : { start: clampedEnd, end: clampedStart };
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

function clampOffset(source: string, offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(Math.trunc(offset), 0), source.length);
}
