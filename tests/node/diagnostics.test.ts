import { describe, expect, it } from "vitest";

import { diagnosticAtSourceOffset, sourceLocationAtOffset } from "../../src/diagnostics";
import { originalPositionFor } from "../../src/source-map";

describe("source-aware diagnostics helpers", () => {
  it("maps offsets to 1-based line and column positions", () => {
    const source = "first\nsecond\nthird";

    expect(sourceLocationAtOffset(source, 0)).toEqual({ line: 1, column: 1 });
    expect(sourceLocationAtOffset(source, 6)).toEqual({ line: 2, column: 1 });
    expect(sourceLocationAtOffset(source, 13)).toEqual({ line: 3, column: 1 });
  });

  it("clamps invalid offsets and spans", () => {
    const source = "abc";

    expect(sourceLocationAtOffset(source, -10)).toEqual({ line: 1, column: 1 });
    expect(sourceLocationAtOffset(source, 999)).toEqual({ line: 1, column: 4 });

    expect(
      diagnosticAtSourceOffset("internal", "transform-failed", "bad range", {
        source,
        offset: 99,
        end: -5,
        file: "input.ts",
      })
    ).toMatchObject({
      file: "input.ts",
      line: 1,
      column: 4,
      span: { start: 0, end: 3 },
    });
  });

  it("uses JavaScript string offsets for CRLF and non-ASCII source text", () => {
    const source = "é\r\nconst value = 'ok';";

    expect(sourceLocationAtOffset(source, 3)).toEqual({ line: 2, column: 1 });
    expect(sourceLocationAtOffset(source, source.indexOf("value"))).toEqual({ line: 2, column: 7 });
  });
});

describe("source-map helpers", () => {
  it("maps generated positions to original 1-based source positions", () => {
    const map = {
      version: 3,
      sources: ["input.tsx"],
      names: [],
      mappings: "UACG",
    };

    expect(originalPositionFor(map, { line: 1, column: 1 })).toBeUndefined();
    expect(originalPositionFor(map, { line: 1, column: 11 })).toEqual({
      source: "input.tsx",
      line: 2,
      column: 4,
    });
    expect(originalPositionFor({ ...map, mappings: ";UACG" }, { line: 1, column: 1 })).toBeUndefined();
  });

  it("returns undefined when the nearest generated segment is unmapped", () => {
    const map = {
      version: 3,
      sources: ["input.tsx"],
      names: [],
      mappings: "UACG,K",
    };

    expect(originalPositionFor(map, { line: 1, column: 11 })).toEqual({
      source: "input.tsx",
      line: 2,
      column: 4,
    });
    expect(originalPositionFor(map, { line: 1, column: 16 })).toBeUndefined();
  });
});
