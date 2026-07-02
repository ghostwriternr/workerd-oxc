import { describe, expect, test } from "vitest";

import { parse, transform } from "../../src/index";
import { expectFailure } from "./helpers";

const BROKEN_TSX = `export const broken = <div>;`;

describe("diagnostics", () => {
  test("parse failures are normalized and source-aware", async () => {
    const [diagnostic] = expectFailure(await parse({ filename: "src/broken.tsx", source: BROKEN_TSX }));

    expect(diagnostic).toMatchObject({
      phase: "parse",
      severity: "error",
      filename: "src/broken.tsx",
      location: { line: 1 },
      span: { start: expect.any(Number) },
      message: expect.any(String),
    });
  });

  test("transform failures are normalized and source-aware", async () => {
    const [diagnostic] = expectFailure(await transform({
      filename: "src/broken.tsx",
      source: `\n  ${BROKEN_TSX}`,
    }));

    expect(diagnostic).toMatchObject({
      phase: "transform",
      severity: "error",
      filename: "src/broken.tsx",
      location: { line: 2 },
    });
    expect(diagnostic?.span?.start).toBeGreaterThan(0);
  });

  test.each([
    ["parse", parse] as const,
    ["transform", transform] as const,
  ])("%s spans use JavaScript string offsets", async (phase, operation) => {
    const source = `const café = 1;\n${BROKEN_TSX}`;
    const [diagnostic] = expectFailure(await operation({ filename: `src/non-ascii-${phase}.tsx`, source }));

    expect(diagnostic).toMatchObject({
      phase,
      filename: `src/non-ascii-${phase}.tsx`,
      location: {
        line: 2,
        column: source.split("\n")[1]!.lastIndexOf(";") + 1,
      },
      span: { start: source.lastIndexOf(";") },
    });
  });
});
