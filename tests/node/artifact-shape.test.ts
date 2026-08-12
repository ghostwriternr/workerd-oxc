import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

function expectZeroImportArtifact(path: string, requiredExport: "analyze") {
  expect(existsSync(path), `${path} should exist`).toBe(true);
  const module = new WebAssembly.Module(readFileSync(path));

  expect(WebAssembly.Module.imports(module)).toEqual([]);

  const exports = WebAssembly.Module.exports(module).map((entry) => `${entry.kind}:${entry.name}`);
  expect(exports).toEqual(
    expect.arrayContaining([
      "memory:memory",
      "function:abi_version",
      "function:alloc",
      "function:free",
      `function:${requiredExport}`,
      "function:result_ptr",
      "function:result_len",
      "function:free_result",
    ]),
  );
}

describe("custom Oxc wasm artifacts", () => {
  test("analyzer artifact has a workerd-compatible zero-import ABI shape", () => {
    expect.hasAssertions();
    expectZeroImportArtifact("src/wasm/analyze.wasm", "analyze");
  });
});
