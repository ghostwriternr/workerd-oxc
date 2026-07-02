import { describe, expect, test } from "vitest";

import { createOxc, transform } from "../../src/index";

describe("transform", () => {
  test("top-level async transform strips TypeScript and lowers TSX", async () => {
    const result = await transform({
      filename: "src/component.tsx",
      source: `
        type Props = { label: string };
        export function Component(props: Props) {
          return <span>{props.label}</span>;
        }
      `,
      jsx: { runtime: "automatic", importSource: "react" },
      sourcemap: true,
    });

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toContain("export function Component");
    expect(result.value.code).not.toContain("type Props");
    expect(result.value.code).toContain("react/jsx-runtime");
    expect(result.value.map).toMatchObject({ version: 3, sources: expect.any(Array), mappings: expect.any(String) });
  });

  test("createOxc returns an instance with sync transform", async () => {
    const oxc = await createOxc();

    const result = oxc.transform({
      filename: "src/view.tsx",
      source: `export const view = <main data-kind="sync">ok</main>;`,
      jsx: { runtime: "automatic" },
    });

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toContain("react/jsx-runtime");
    expect(result.value.code).toContain("data-kind");
  });

  test("accepts type-only TypeScript modules that erase to empty JavaScript", async () => {
    const result = await transform({
      filename: "src/types.ts",
      source: `
        type Props = { label: string };
        interface ViewModel { count: number }
      `,
      sourcemap: false,
    });

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;
    expect(result.value.code.trim()).toBe("");
    expect(result.value.map).toBeUndefined();
  });

  test("preserves JSX when requested", async () => {
    const result = await transform({
      filename: "src/preserve.tsx",
      source: `export const view = <strong>ok</strong>;`,
      jsx: "preserve",
      sourcemap: false,
    });

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toContain("<strong>ok</strong>");
    expect(result.value.code).not.toContain("react/jsx-runtime");
  });

  test("infers TypeScript for .cts filenames", async () => {
    const result = await transform({
      filename: "src/config.cts",
      source: `const value: string = "ok";`,
      sourcemap: false,
    });

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toContain("const value");
    expect(result.value.code).not.toContain(": string");
  });

  test("rejects target arrays instead of silently dropping entries", async () => {
    const result = await transform({
      filename: "src/target.ts",
      source: `export const value: string = "ok";`,
      target: ["es2022", "es2020"],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      phase: "transform",
      severity: "error",
      filename: "src/target.ts",
    });
    expect(result.diagnostics[0]?.message).toContain("target arrays");
  });
});
