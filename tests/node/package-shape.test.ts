import { describe, expect, test } from "vitest";

import * as pkg from "../../src/index";

describe("public package shape", () => {
  test("exports only the focused workerd-oxc runtime API", () => {
    expect(Object.keys(pkg).sort()).toEqual(["createOxc", "parse", "transform"]);
  });
});
