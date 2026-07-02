import { describe, expect, test } from "vitest";

import { transform } from "../../src/index";
import { expectOk } from "./helpers";
import { originalPositionFor } from "./source-map-helpers";

const SOURCE = `
  type Props = { label: string };
  export function Component(props: Props) {
    return <span>{props.label}</span>;
  }
`;

describe("source maps", () => {
  test("transform omits maps unless requested", async () => {
    const { map } = expectOk(await transform({ filename: "src/component.tsx", source: SOURCE }));

    expect(map).toBeUndefined();
  });

  test("sourcemap output keeps original source identity", async () => {
    const { map } = expectOk(await transform({
      filename: "src/component.tsx",
      source: SOURCE,
      sourcemap: true,
    }));

    expect(map).toMatchObject({
      version: 3,
      names: expect.any(Array),
      sources: ["src/component.tsx"],
      sourcesContent: [SOURCE],
      mappings: expect.any(String),
    });
  });

  test("injected JSX runtime import is unmapped", async () => {
    const { code, map } = expectOk(await transform({
      filename: "src/component.tsx",
      source: SOURCE,
      sourcemap: true,
    }));

    expect(map).toBeDefined();
    const generated = findGeneratedPosition(code, "react/jsx-runtime");
    expect(originalPositionFor(map!, generated)).toBeUndefined();
  });

  test("generated function declaration maps to original function declaration", async () => {
    const { code, map } = expectOk(await transform({
      filename: "src/component.tsx",
      source: SOURCE,
      sourcemap: true,
    }));

    expect(map).toBeDefined();
    const generated = findGeneratedPosition(code, "export function Component");
    const original = originalPositionFor(map!, generated);

    expect(original).toMatchObject({
      source: "src/component.tsx",
      line: lineContaining(SOURCE, "export function Component"),
    });
  });

  test("generated JSX call maps to original JSX return", async () => {
    const { code, map } = expectOk(await transform({
      filename: "src/component.tsx",
      source: SOURCE,
      sourcemap: true,
    }));

    expect(map).toBeDefined();
    const generated = findGeneratedLinePosition(code, (line) => line.includes("_jsx") && line.includes("span"));
    const original = originalPositionFor(map!, generated);

    expect(original).toMatchObject({
      source: "src/component.tsx",
      line: lineContaining(SOURCE, "return <span>"),
    });
  });
});

function findGeneratedPosition(code: string, needle: string): { line: number; column: number } {
  return findGeneratedLinePosition(code, (line) => line.includes(needle), needle);
}

function findGeneratedLinePosition(
  code: string,
  predicate: (line: string) => boolean,
  description = "matching generated line",
): { line: number; column: number } {
  const lines = code.split("\n");
  const lineIndex = lines.findIndex(predicate);
  expect(lineIndex, `${description} should exist in generated code`).toBeGreaterThanOrEqual(0);
  const line = lines[lineIndex]!;
  const firstNonWhitespace = line.search(/\S/);
  return { line: lineIndex + 1, column: Math.max(firstNonWhitespace, 0) };
}

function lineContaining(source: string, needle: string): number {
  const lineIndex = source.split("\n").findIndex((line) => line.includes(needle));
  expect(lineIndex, `${needle} should exist in source`).toBeGreaterThanOrEqual(0);
  return lineIndex + 1;
}
