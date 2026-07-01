import { describe, expect, it } from "vitest";
import { measureWranglerBundleShape } from "./wrangler-bundle-shape-helpers";

const CASES = [
  { caseName: "babel", entrypoint: "tests/bundle-shape/entries/babel.ts" },
  { caseName: "swc", entrypoint: "tests/bundle-shape/entries/swc.ts" },
  { caseName: "oxc", entrypoint: "tests/bundle-shape/entries/oxc.ts" },
  { caseName: "oxc-ast", entrypoint: "tests/bundle-shape/entries/oxc-ast.ts" },
  { caseName: "oxc-transform", entrypoint: "tests/bundle-shape/entries/oxc-transform.ts" }
] as const;

function assertFiniteNonNegative(value: number): void {
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(0);
}

describe("Wrangler dry-run bundle and startup-check shape", () => {
  it("records deployable bundle output and startup-check signals for Babel, SWC, and Oxc fixtures", async () => {
    const results = [];
    for (const entry of CASES) {
      results.push(await measureWranglerBundleShape(entry.caseName, entry.entrypoint));
    }

    for (const result of results) {
      expect(result.ok, result.stderr || result.stdout).toBe(true);
      expect(result.files.length).toBeGreaterThan(0);
      assertFiniteNonNegative(result.totalBytes);
      assertFiniteNonNegative(result.metafileInputBytes);
      assertFiniteNonNegative(result.metafileOutputBytes);
      expect(result.wranglerUploadBytes).toBeGreaterThan(0);
      expect(result.wranglerUploadGzipBytes).toBeGreaterThan(0);
      expect(typeof result.startupOk).toBe("boolean");
      expect(result.startupCommand.length).toBeGreaterThan(0);
      expect(`${result.startupStdout}\n${result.startupStderr}`.length).toBeGreaterThan(0);
      for (const file of result.files) assertFiniteNonNegative(file.bytes);
    }

    console.log("[wrangler-bundle-shape]", JSON.stringify(results));
  }, 120_000);
});
