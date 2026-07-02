import { describe, expect, test } from "vitest";

import { createOxc, parse, transform } from "../../src/index";

describe("Oxc lifecycle", () => {
  test("reuses top-level singleton across repeated parse and transform calls", async () => {
    const firstParse = await parse({ filename: "src/one.tsx", source: `export const one = <p>one</p>;` });
    const firstTransform = await transform({ filename: "src/one.tsx", source: `export const one = <p>one</p>;` });
    const secondParse = await parse({ filename: "src/two.tsx", source: `export const two = <p>two</p>;` });
    const secondTransform = await transform({ filename: "src/two.tsx", source: `export const two = <p>two</p>;` });

    expect(firstParse.ok, JSON.stringify(firstParse.diagnostics, null, 2)).toBe(true);
    expect(firstTransform.ok, JSON.stringify(firstTransform.diagnostics, null, 2)).toBe(true);
    expect(secondParse.ok, JSON.stringify(secondParse.diagnostics, null, 2)).toBe(true);
    expect(secondTransform.ok, JSON.stringify(secondTransform.diagnostics, null, 2)).toBe(true);
  });

  test("an instance recovers after syntax failures", async () => {
    const oxc = await createOxc();

    const brokenParse = oxc.parse({ filename: "src/broken.tsx", source: `export const broken = <div>;` });
    const recoveredParse = oxc.parse({ filename: "src/recovered.tsx", source: `export const value = <p>ok</p>;` });
    const brokenTransform = oxc.transform({ filename: "src/broken.tsx", source: `export const broken = <div>;` });
    const recoveredTransform = oxc.transform({ filename: "src/recovered.tsx", source: `export const value = <p>ok</p>;` });

    expect(brokenParse.ok).toBe(false);
    expect(recoveredParse.ok, JSON.stringify(recoveredParse.diagnostics, null, 2)).toBe(true);
    expect(brokenTransform.ok).toBe(false);
    expect(recoveredTransform.ok, JSON.stringify(recoveredTransform.diagnostics, null, 2)).toBe(true);
  });
});
