import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "workerd-oxc-packed-"));

try {
  run("npm", ["run", "build"], { cwd: root });
  const tarballName = run(
    "npm",
    ["pack", "--ignore-scripts", "--silent", "--pack-destination", tempRoot],
    { cwd: root },
  )
    .trim()
    .split("\n")
    .at(-1);
  if (!tarballName) throw new Error("npm pack did not return a tarball name");
  const tarball = resolve(tempRoot, tarballName);

  const fixture = join(tempRoot, "fixture");
  mkdirSync(join(fixture, "tests"), { recursive: true });

  writeFileSync(join(fixture, "package.json"), JSON.stringify({ type: "module" }, null, 2));
  writeFileSync(
    join(fixture, "wrangler.jsonc"),
    JSON.stringify(
      {
        name: "workerd-oxc-packed-consumer",
        main: "tests/entry.ts",
        compatibility_date: "2026-06-30",
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(fixture, "tests", "entry.ts"),
    "export default { fetch() { return new Response('ok') } };\n",
  );
  writeFileSync(
    join(fixture, "vitest.config.ts"),
    `
    import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
    import { defineConfig } from "vitest/config";

    export default defineConfig({
      plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
      test: {
        include: ["tests/**/*.test.ts"],
        hookTimeout: 30_000,
        testTimeout: 30_000,
      },
    });
  `,
  );
  writeFileSync(
    join(fixture, "tests", "packed.test.ts"),
    `
    import { describe, expect, test } from "vitest";
    import { createOxc, transform } from "workerd-oxc";

    describe("packed workerd-oxc", () => {
      test("transforms TSX from the packed package inside workerd", async () => {
        const topLevel = await transform({
          filename: "src/component.tsx",
          source: 'type Props = { label: string }; export const view = <span>{"ok"}</span>;',
          sourcemap: true,
        });

        expect(topLevel.ok, JSON.stringify(topLevel.diagnostics, null, 2)).toBe(true);
        if (!topLevel.ok) return;
        expect(topLevel.value.code).toContain("react/jsx-runtime");
        expect(topLevel.value.map).toMatchObject({ version: 3 });

        const oxc = await createOxc();
        const parsed = oxc.parse({ filename: "src/component.tsx", source: 'export const view = <span>{"ok"}</span>;' });
        expect(parsed.ok, JSON.stringify(parsed.diagnostics, null, 2)).toBe(true);
      });
    });
  `,
  );

  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--save-dev",
      "vitest@4.1.9",
      "@cloudflare/vitest-pool-workers@0.17.0",
      "wrangler@4.106.0",
      "typescript@6.0.3",
      tarball,
    ],
    { cwd: fixture },
  );
  run("npx", ["vitest", "run", "--config", "vitest.config.ts"], { cwd: fixture });

  console.log("packed worker check ok");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function run(command, args, options) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}
