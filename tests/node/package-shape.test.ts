import { describe, expect, test } from "vitest";

import * as pkg from "../../src/index";

describe("public package shape", () => {
  test("exports the focused workerd-oxc API", () => {
    expect(Object.keys(pkg).sort()).toEqual([
      "compileDynamicWorkerModules",
      "dynamicWorkerBuildId",
      "experimentalParseReactTsxAstDirect",
      "hashDynamicWorkerBuild",
      "loadDynamicWorker",
      "parseReactTsxAst",
      "toLoaderDefinition",
      "transformReactTsx",
    ]);
  });
});
