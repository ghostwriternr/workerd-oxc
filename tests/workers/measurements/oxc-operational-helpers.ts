import type { ReactWorkerBuildInput } from "../../../src/types";

export interface MeasurementSample<T = unknown> {
  label: string;
  index: number;
  durationMs: number;
  value: T;
}

export interface MeasurementSummary<T = unknown> {
  label: string;
  count: number;
  firstMs: number;
  warmAvgMs: number;
  minMs: number;
  maxMs: number;
  totalMs: number;
  returnValues: T[];
}

export async function measureSeries<T>(
  label: string,
  iterations: number,
  operation: () => T | Promise<T>,
): Promise<MeasurementSample<T>[]> {
  const samples: MeasurementSample<T>[] = [];

  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    const value = await operation();
    samples.push({
      label,
      index,
      durationMs: performance.now() - start,
      value,
    });
  }

  return samples;
}

export function summarizeDurations<T>(samples: MeasurementSample<T>[]): MeasurementSummary<T> {
  if (samples.length === 0) {
    throw new Error("Cannot summarize an empty measurement series");
  }

  const durations = samples.map((sample) => sample.durationMs);
  const totalMs = durations.reduce((sum, duration) => sum + duration, 0);
  const warmDurations = durations.slice(1);
  const warmAvgMs =
    warmDurations.length === 0
      ? 0
      : warmDurations.reduce((sum, duration) => sum + duration, 0) / warmDurations.length;

  return {
    label: samples[0].label,
    count: samples.length,
    firstMs: durations[0],
    warmAvgMs,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    totalMs,
    returnValues: samples.map((sample) => sample.value),
  };
}

export function createOxcMeasurementGraph(moduleCount: number): ReactWorkerBuildInput {
  const files: Record<string, string> = {};
  const imports: string[] = [];

  for (let index = 0; index < moduleCount; index += 1) {
    const path = `src/module-${index}.tsx`;
    files[path] = `
      export function value${index}() {
        return ${index}
      }
    `;
    imports.push(`import { value${index} } from "./module-${index}";`);
  }

  files["src/index.tsx"] = `
    ${imports.join("\n")}
    export default {
      async fetch() {
        const total = ${Array.from({ length: moduleCount }, (_, index) => `value${index}()`).join(" + ")};
        return new Response(String(total));
      }
    }
  `;

  return {
    entrypoint: "src/index.tsx",
    files,
  };
}
