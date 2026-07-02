import { describe, expect, test } from "vitest";

import { createOxc, transform } from "../../src/index";
import { expectFailure, expectOk } from "./helpers";

describe("transform", () => {
  test("top-level transform strips TypeScript and lowers TSX", async () => {
    const { code, map } = expectOk(await transform({
      filename: "src/component.tsx",
      source: `
        type Props = { label: string };
        export function Component(props: Props) {
          return <span>{props.label}</span>;
        }
      `,
      jsx: { runtime: "automatic", importSource: "react" },
      sourcemap: true,
    }));

    expect(code).toContain("export function Component");
    expect(code).not.toContain("type Props");
    expect(code).toContain("react/jsx-runtime");
    expect(map).toMatchObject({ version: 3, sources: expect.any(Array), mappings: expect.any(String) });
  });

  test("createOxc exposes sync transform", async () => {
    const oxc = await createOxc();
    const { code } = expectOk(oxc.transform({
      filename: "src/view.tsx",
      source: `export const view = <main data-kind="sync">ok</main>;`,
    }));

    expect(code).toContain("react/jsx-runtime");
    expect(code).toContain("data-kind");
  });

  test("allows type-only modules to erase to empty JavaScript", async () => {
    const { code, map } = expectOk(await transform({
      filename: "src/types.ts",
      source: `
        type Props = { label: string };
        interface ViewModel { count: number }
      `,
    }));

    expect(code.trim()).toBe("");
    expect(map).toBeUndefined();
  });

  test("preserves JSX when requested", async () => {
    const { code } = expectOk(await transform({
      filename: "src/preserve.tsx",
      source: `export const view = <strong>ok</strong>;`,
      jsx: "preserve",
    }));

    expect(code).toContain("<strong>ok</strong>");
    expect(code).not.toContain("react/jsx-runtime");
  });

  test("infers TypeScript from .cts filenames", async () => {
    const { code } = expectOk(await transform({
      filename: "src/config.cts",
      source: `const value: string = "ok";`,
    }));

    expect(code).toContain("const value");
    expect(code).not.toContain(": string");
  });

  test("rejects target arrays rather than silently dropping entries", async () => {
    const diagnostics = expectFailure(await transform({
      filename: "src/target.ts",
      source: `export const value: string = "ok";`,
      target: ["es2022", "es2020"] as never,
    }));

    expect(diagnostics[0]).toMatchObject({
      phase: "transform",
      severity: "error",
      filename: "src/target.ts",
      message: expect.stringContaining("target arrays"),
    });
  });
});
