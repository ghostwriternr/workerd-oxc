import { expect } from "vitest";

import type { OxcDiagnostic, OxcResult } from "../../src/index";

export function expectOk<T>(result: OxcResult<T>): T {
  expect(result.ok, formatDiagnostics(result)).toBe(true);
  if (!result.ok) throw new Error(formatDiagnostics(result));
  return result.value;
}

export function expectFailure(result: OxcResult<unknown>): OxcDiagnostic[] {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected operation to fail.");
  expect(result.diagnostics.length).toBeGreaterThan(0);
  return result.diagnostics;
}

function formatDiagnostics<T>(result: OxcResult<T>): string {
  return JSON.stringify(result.diagnostics, null, 2);
}
