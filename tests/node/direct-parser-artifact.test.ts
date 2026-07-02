import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("Oxc direct parser wasm artifact", () => {
  test("has a workerd-compatible zero-import ABI shape", () => {
    const directParserModule = new WebAssembly.Module(readFileSync("src/wasm/oxc-direct-parser.wasm"));

    const imports = WebAssembly.Module.imports(directParserModule);
    expect(imports).toEqual([]);

    const exports = WebAssembly.Module.exports(directParserModule).map((entry) => `${entry.kind}:${entry.name}`);
    expect(exports).toEqual(expect.arrayContaining([
      "memory:memory",
      "function:abi_version",
      "function:alloc",
      "function:free",
      "function:parse",
      "function:result_ptr",
      "function:result_len",
      "function:free_result",
    ]));
  });
});
