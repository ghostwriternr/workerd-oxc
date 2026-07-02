import { env } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import { createOxc } from "../../src/index";
import { expectOk } from "./helpers";

describe("Worker Loader example proof", () => {
  test("loads transformed output with a manual Worker Loader definition", async () => {
    const oxc = await createOxc();
    const { code } = expectOk(
      await oxc.transform({
        filename: "index.ts",
        source: `
        export default {
          fetch() {
            return new Response("hello from transformed worker");
          }
        };
      `,
      }),
    );

    const worker = env.LOADER.get("manual-oxc-transform-example", () => ({
      mainModule: "index.js",
      modules: { "index.js": code },
      compatibilityDate: "2026-06-30",
    }));

    const response = await worker.getEntrypoint().fetch(new Request("https://example.com/"));
    await expect(response.text()).resolves.toBe("hello from transformed worker");
  });
});
