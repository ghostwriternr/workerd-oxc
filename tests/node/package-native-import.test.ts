import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("native Node package import", () => {
  test("self-imports without eagerly loading workerd-only Oxc runtime modules", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      "--input-type=module",
      "--eval",
      `const mod = await import("workerd-oxc"); console.log(Object.keys(mod).sort().join(","));`,
    ], { cwd: process.cwd() });

    expect(stdout.trim()).toBe([
      "compileDynamicWorkerModules",
      "dynamicWorkerBuildId",
      "experimentalParseReactTsxAstDirect",
      "hashDynamicWorkerBuild",
      "loadDynamicWorker",
      "parseReactTsxAst",
      "toLoaderDefinition",
      "transformReactTsx",
    ].join(","));
  });
});
