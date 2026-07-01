import { describe, expect, test } from "vitest";

import { compileDynamicWorker } from "../../../src/index";
import { experimentalParseReactTsxAstWithOxc } from "../../../src/oxc/ast";
import {
  createOxcMeasurementGraph,
  measureSeries,
  summarizeDurations,
} from "./oxc-operational-helpers";

describe("Oxc operational measurements", () => {
  test("records first and warm AST materialization timings", async () => {
    const source = `
      type Props = { title: string }
      export function Widget(props: Props) {
        return <section data-kind="widget">{props.title}</section>
      }
    `;

    const samples = await measureSeries("oxc ast", 3, async () => {
      const result = await experimentalParseReactTsxAstWithOxc(source, "component.tsx");
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Oxc AST parse failed");
      expect(result.ast.type).toBe("Program");
      return result.rawProgramLength;
    });

    const summary = summarizeDurations(samples);
    console.log("[measurement]", JSON.stringify(summary));
    expect(summary.count).toBe(3);
    expect(summary.firstMs).toBeGreaterThanOrEqual(0);
    expect(summary.maxMs).toBeGreaterThanOrEqual(summary.minMs);
  });

  test("records repeated compile timings for a 10 module graph", async () => {
    const input = createOxcMeasurementGraph(10);

    const samples = await measureSeries("oxc compile 10 modules", 3, async () => {
      const result = await compileDynamicWorker(input);
      expect(result.ok).toBe(true);
      if (!result.ok || !result.modules) throw new Error("Oxc compile failed");
      const moduleCount = Object.keys(result.modules).length;
      expect(moduleCount).toBeGreaterThanOrEqual(10);
      return moduleCount;
    });

    const summary = summarizeDurations(samples);
    console.log("[measurement]", JSON.stringify(summary));
    expect(summary.count).toBe(3);
    expect(summary.returnValues.every((value) => value >= 10)).toBe(true);
  });

  test("recovers after an Oxc parse failure", async () => {
    const failed = await experimentalParseReactTsxAstWithOxc("export const =", "broken.tsx");
    expect(failed.ok).toBe(false);

    const recovered = await experimentalParseReactTsxAstWithOxc("export const value = <div />", "ok.tsx");
    expect(recovered.ok).toBe(true);
  });
});
