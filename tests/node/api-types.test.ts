import { describe, expect, test } from "vitest";

import type { TransformInput } from "../../src/index";
import { createOxc } from "../../src/index";

// @ts-expect-error CreateOxcOptions is intentionally not exported.
import type { CreateOxcOptions } from "../../src/index";

describe("public API types", () => {
  test("transform target is a single string", () => {
    const valid: TransformInput = {
      filename: "src/input.ts",
      source: "export const value = 1;",
      target: "es2022",
    };

    expect(valid.target).toBe("es2022");

    const invalid: TransformInput = {
      filename: "src/input.ts",
      source: "export const value = 1;",
      // @ts-expect-error target arrays are intentionally not part of the public API.
      target: ["es2022", "es2020"],
    };

    expect(Array.isArray(invalid.target)).toBe(true);
  });

  test("createOxc has no options object", async () => {
    type CreateOxcArgs = Parameters<typeof createOxc>;

    const valid: CreateOxcArgs = [];
    expect(valid).toEqual([]);

    // @ts-expect-error createOxc does not accept placeholder options.
    const invalid: CreateOxcArgs = [{}];
    expect(invalid).toEqual([{}]);

    // @ts-expect-error exercise runtime behavior for untyped JavaScript callers.
    await expect(createOxc({})).rejects.toThrow("does not accept options");
  });
});
