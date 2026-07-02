import { describe, expect, test } from "vitest";

import { createOxc, parse } from "../../src/index";
import { expectOk } from "./helpers";

const TSX_SOURCE = `
  type Props = { label: string; count?: number };
  export function Component(props: Props) {
    return <section data-kind="fixture">{props.label}</section>;
  }
`;

describe("parse", () => {
  test("top-level parse materializes a TSX Program AST", async () => {
    const { ast, rawProgramLength } = expectOk(await parse({
      filename: "src/component.tsx",
      source: TSX_SOURCE,
      range: true,
    }));

    expect(rawProgramLength).toBeGreaterThan(1000);
    expect(ast).toMatchObject({ type: "Program", sourceType: "module" });
    expect(ast.body.some((node) => (node as { type?: string }).type === "TSTypeAliasDeclaration")).toBe(true);
    expect(JSON.stringify(ast)).toContain("JSXElement");
  });

  test("createOxc exposes sync parse", async () => {
    const oxc = await createOxc();
    const { ast } = expectOk(oxc.parse({ filename: "src/component.tsx", source: TSX_SOURCE, range: true }));

    expect(ast.type).toBe("Program");
  });

  test("infers TypeScript from .cts filenames", async () => {
    const { ast } = expectOk(await parse({
      filename: "src/config.cts",
      source: `const value: string = "ok";`,
    }));

    expect(ast.body.some((node) => (node as { type?: string }).type === "VariableDeclaration")).toBe(true);
  });
});
