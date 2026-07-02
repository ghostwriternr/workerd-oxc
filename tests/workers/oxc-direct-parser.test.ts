import { describe, expect, test } from "vitest";

import { experimentalParseReactTsxAstDirect, parseReactTsxAst } from "../../src/index";

describe("experimentalParseReactTsxAstDirect", () => {
  test("materializes TSX ASTs through direct wasm ABI inside workerd", async () => {
    const source = `
      type Props = { label: string; count?: number };
      export function Component(props: Props) {
        return <section data-kind="direct">{props.label}</section>;
      }
    `;

    const result = await experimentalParseReactTsxAstDirect("src/component.tsx", source, { range: true });

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;

    expect(result.rawProgramLength).toBeGreaterThan(1000);
    expect(result.ast.type).toBe("Program");
    expect(result.ast.sourceType).toBe("module");
    expect(result.ast.body.some((node) => (node as { type?: string }).type === "TSTypeAliasDeclaration")).toBe(true);
    expect(JSON.stringify(result.ast)).toContain("JSXElement");
  });

  test("matches the current wasmkernel parser on structural TSX landmarks", async () => {
    const source = `
      const value = 1n;
      const pattern = /demo/gi;
      export const element = <main>{String(value)} {pattern.source}</main>;
    `;

    const direct = await experimentalParseReactTsxAstDirect("src/component.tsx", source, { range: true });
    const bridge = await parseReactTsxAst("src/component.tsx", source, { range: true });

    expect(direct.ok, JSON.stringify(direct.diagnostics, null, 2)).toBe(true);
    expect(bridge.ok, JSON.stringify(bridge.diagnostics, null, 2)).toBe(true);
    if (!direct.ok || !bridge.ok) return;

    const directJson = JSON.stringify(direct.ast, (_key, value) => typeof value === "bigint" ? `${value}n` : value);

    expect(direct.ast.type).toBe(bridge.ast.type);
    expect(directJson).toContain("JSXElement");
    expect(directJson).toContain("Literal");
    expect(directJson).toContain("bigint");
    expect(directJson).toContain("regex");
  });

  test("returns structured diagnostics for direct parser failures", async () => {
    const result = await experimentalParseReactTsxAstDirect("src/broken.tsx", `export const broken = <div>;`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      tool: "oxc-parser",
      kind: "parse-failed",
      severity: "error",
      file: "src/broken.tsx",
    });
  });

  test("reuses the direct parser after failed parses", async () => {
    const first = await experimentalParseReactTsxAstDirect("src/first.tsx", `export const first = <p>first</p>;`);
    const broken = await experimentalParseReactTsxAstDirect("src/broken.tsx", `export const broken = <div>;`);
    const second = await experimentalParseReactTsxAstDirect("src/second.tsx", `export const second = <p>second</p>;`);

    expect(first.ok, JSON.stringify(first.diagnostics, null, 2)).toBe(true);
    expect(broken.ok).toBe(false);
    expect(second.ok, JSON.stringify(second.diagnostics, null, 2)).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.ast.type).toBe("Program");
    expect(second.ast.type).toBe("Program");
  });

  test("recovers after non-JSON-safe options fail before parsing", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const failed = await experimentalParseReactTsxAstDirect("src/cyclic.tsx", `export const value = <p />;`, cyclic);
    const recovered = await experimentalParseReactTsxAstDirect("src/recovered.tsx", `export const value = <p />;`);

    expect(failed.ok).toBe(false);
    expect(failed.diagnostics[0]?.message).toContain("direct parser failed");
    expect(recovered.ok, JSON.stringify(recovered.diagnostics, null, 2)).toBe(true);
  });
});
