import { describe, expect, test } from "vitest";

import { parse, transform } from "../../src/index";

describe("diagnostics", () => {
  test("parse failures return normalized source-aware diagnostics", async () => {
    const result = await parse({ filename: "src/broken.tsx", source: `export const broken = <div>;` });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      phase: "parse",
      severity: "error",
      filename: "src/broken.tsx",
      location: { line: 1 },
    });
    expect(result.diagnostics[0]?.message).toEqual(expect.any(String));
    expect(result.diagnostics[0]?.span?.start).toEqual(expect.any(Number));
  });

  test("transform failures return normalized source-aware diagnostics", async () => {
    const result = await transform({ filename: "src/broken.tsx", source: `\n  export const broken = <div>;` });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      phase: "transform",
      severity: "error",
      filename: "src/broken.tsx",
      location: { line: 2 },
    });
    expect(result.diagnostics[0]?.span?.start).toBeGreaterThan(0);
  });

  test("transform diagnostic spans are JavaScript string offsets, not native UTF-8 byte offsets", async () => {
    const source = `const café = 1;\nexport const broken = <div>;`;
    const result = await transform({ filename: "src/non-ascii.tsx", source });

    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic).toMatchObject({
      phase: "transform",
      filename: "src/non-ascii.tsx",
      location: {
        line: 2,
        column: source.split("\n")[1]!.lastIndexOf(";") + 1,
      },
    });
    expect(diagnostic?.span?.start).toBe(source.lastIndexOf(";"));
  });

  test("parse diagnostic spans are JavaScript string offsets, not native UTF-8 byte offsets", async () => {
    const source = `const café = 1;\nexport const broken = <div>;`;
    const result = await parse({ filename: "src/non-ascii.tsx", source });

    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic).toMatchObject({
      phase: "parse",
      filename: "src/non-ascii.tsx",
      location: {
        line: 2,
        column: source.split("\n")[1]!.lastIndexOf(";") + 1,
      },
    });
    expect(diagnostic?.span?.start).toBe(source.lastIndexOf(";"));
  });
});
