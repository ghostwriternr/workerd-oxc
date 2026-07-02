import { env } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import { createOxc } from "../../src/index";

describe("Worker Loader example proof", () => {
  test("loads transformed output with a manual Worker Loader definition", async () => {
    const oxc = await createOxc();
    const transformed = oxc.transform({
      filename: "index.tsx",
      source: `
        export default {
          fetch() {
            return new Response("hello from transformed worker");
          }
        };
      `,
      sourcemap: false,
    });

    expect(transformed.ok, JSON.stringify(transformed.diagnostics, null, 2)).toBe(true);
    if (!transformed.ok) return;

    const worker = env.LOADER.get("manual-oxc-transform-example", () => ({
      mainModule: "index.js",
      modules: {
        "index.js": transformed.value.code,
      },
      compatibilityDate: "2026-06-30",
    }));

    const response = await worker.getEntrypoint().fetch(new Request("https://example.com/"));
    await expect(response.text()).resolves.toBe("hello from transformed worker");
  });
});
