import { describe, expect, test } from "vitest";

import { createOxc, parse } from "../../src/index";

describe("parse", () => {
  const source = `
    type Props = { label: string; count?: number };
    export function Component(props: Props) {
      return <section data-kind="direct">{props.label}</section>;
    }
  `;

  test("top-level async parse materializes TSX ASTs inside workerd", async () => {
    const result = await parse({ filename: "src/component.tsx", source, range: true });

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;

    expect(result.value.rawProgramLength).toBeGreaterThan(1000);
    expect(result.value.ast.type).toBe("Program");
    expect(result.value.ast.sourceType).toBe("module");
    expect(result.value.ast.body.some((node) => (node as { type?: string }).type === "TSTypeAliasDeclaration")).toBe(true);
    expect(JSON.stringify(result.value.ast)).toContain("JSXElement");
  });

  test("createOxc returns an instance with sync parse", async () => {
    const oxc = await createOxc();

    const result = oxc.parse({ filename: "src/component.tsx", source, lang: "tsx", astType: "ts", range: true });

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;
    expect(result.value.ast.type).toBe("Program");
  });

  test("infers TypeScript for .cts filenames", async () => {
    const result = await parse({ filename: "src/config.cts", source: `const value: string = "ok";` });

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;
    expect(result.value.ast.body.some((node) => (node as { type?: string }).type === "VariableDeclaration")).toBe(true);
  });
});
