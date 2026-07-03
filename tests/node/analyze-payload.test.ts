import { describe, expect, test } from "vitest";

import { parseAnalyzePayloadForTest } from "../../src/analyze-payload";

describe("analyze payload validation", () => {
  const input = { filename: "src/file.tsx", source: "const x = <View />;" };

  test("rejects successful payloads with missing fact arrays", () => {
    const result = parseAnalyzePayloadForTest(input, {
      abiVersion: 1,
      kind: "analyze",
      ok: true,
      scopes: [],
      bindings: [],
      references: [],
      unresolved: [],
      imports: [],
      exports: [],
      diagnostics: [],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: "runtime", severity: "error" })]),
    );
  });

  test("rejects successful payloads with malformed import facts", () => {
    const result = parseAnalyzePayloadForTest(input, {
      abiVersion: 1,
      kind: "analyze",
      ok: true,
      scopes: [],
      bindings: [],
      references: [],
      unresolved: [],
      imports: [{ source: "./mod", local: "x", imported: "default", kind: "value" }],
      exports: [],
      jsxTags: [],
      diagnostics: [],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain("Malformed Oxc analyzer payload");
  });

  test("rejects successful payloads with malformed export facts", () => {
    const result = parseAnalyzePayloadForTest(input, {
      abiVersion: 1,
      kind: "analyze",
      ok: true,
      scopes: [],
      bindings: [],
      references: [],
      unresolved: [],
      imports: [],
      exports: [{ kind: "all", local: "x", source: "./mod", span: { start: 0, end: 1 } }],
      jsxTags: [],
      diagnostics: [],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain("Malformed Oxc analyzer payload");
  });

  test("accepts JSX expression attributes carrying valid literal facts", () => {
    const result = parseAnalyzePayloadForTest(input, {
      abiVersion: 1,
      kind: "analyze",
      ok: true,
      scopes: [],
      bindings: [],
      references: [],
      unresolved: [],
      imports: [],
      exports: [],
      jsxTags: [
        {
          id: 1,
          name: "View",
          kind: "identifier",
          span: { start: 10, end: 40 },
          nameSpan: { start: 11, end: 15 },
          elementSpan: { start: 10, end: 40 },
          selfClosing: true,
          attributes: [
            {
              kind: "attribute",
              name: "box",
              nameSpan: { start: 16, end: 19 },
              span: { start: 16, end: 38 },
              value: {
                kind: "expression",
                span: { start: 20, end: 38 },
                literal: {
                  type: "object",
                  properties: [
                    { key: "x", value: { type: "number", value: 80 } },
                    { key: "items", value: { type: "array", elements: [{ type: "null" }] } },
                  ],
                },
              },
            },
          ],
          children: [],
        },
      ],
      diagnostics: [],
    });

    expect(result.ok).toBe(true);
  });

  test("rejects JSX expression literals that are not JSON-shaped", () => {
    const result = parseAnalyzePayloadForTest(input, {
      abiVersion: 1,
      kind: "analyze",
      ok: true,
      scopes: [],
      bindings: [],
      references: [],
      unresolved: [],
      imports: [],
      exports: [],
      jsxTags: [
        {
          id: 1,
          name: "View",
          kind: "identifier",
          span: { start: 10, end: 40 },
          nameSpan: { start: 11, end: 15 },
          elementSpan: { start: 10, end: 40 },
          selfClosing: true,
          attributes: [
            {
              kind: "attribute",
              name: "n",
              nameSpan: { start: 16, end: 17 },
              span: { start: 16, end: 24 },
              value: {
                kind: "expression",
                span: { start: 18, end: 24 },
                literal: { type: "number", value: "80" },
              },
            },
          ],
          children: [],
        },
      ],
      diagnostics: [],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain("Malformed Oxc analyzer payload");
  });

  test("rejects JSX children with unknown kinds", () => {
    const result = parseAnalyzePayloadForTest(input, {
      abiVersion: 1,
      kind: "analyze",
      ok: true,
      scopes: [],
      bindings: [],
      references: [],
      unresolved: [],
      imports: [],
      exports: [],
      jsxTags: [
        {
          id: 1,
          name: "View",
          kind: "identifier",
          span: { start: 10, end: 18 },
          nameSpan: { start: 11, end: 15 },
          elementSpan: { start: 10, end: 18 },
          selfClosing: true,
          attributes: [],
          children: [{ kind: "impossible", span: { start: 0, end: 1 } }],
        },
      ],
      diagnostics: [],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain("Malformed Oxc analyzer payload");
  });
});
