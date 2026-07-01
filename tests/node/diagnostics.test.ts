import { describe, expect, it } from "vitest";

import { diagnosticAtSourceOffset, sourceLocationAtOffset } from "../../src/diagnostics";

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
