import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

function expectZeroImportArtifact(path: string, requiredExport: "parse" | "transform") {
  expect(existsSync(path), `${path} should exist`).toBe(true);
  const module = new WebAssembly.Module(readFileSync(path));

  expect(WebAssembly.Module.imports(module)).toEqual([]);

  const exports = WebAssembly.Module.exports(module).map((entry) => `${entry.kind}:${entry.name}`);
  expect(exports).toEqual(expect.arrayContaining([
    "memory:memory",
    "function:abi_version",
    "function:alloc",
    "function:free",
    `function:${requiredExport}`,
    "function:result_ptr",
    "function:result_len",
    "function:free_result",
  ]));
}

describe("direct Oxc wasm artifacts", () => {
  test("parser artifact has a workerd-compatible zero-import ABI shape", () => {
    expectZeroImportArtifact("src/wasm/parser.wasm", "parse");
  });

  test("transform artifact has a workerd-compatible zero-import ABI shape", () => {
    expectZeroImportArtifact("src/wasm/transform.wasm", "transform");
  });
});
