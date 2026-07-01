import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { compileDynamicWorker, loadDynamicWorker } from "../../../src/index";
import type { WorkerLoaderBinding } from "../../../src/types";

interface Env {
  LOADER: WorkerLoaderBinding;
}

const workerEnv = env as unknown as Env;

let id = 0;

describe("constrained package resolver", () => {
  it("rejects package export targets outside the package root", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import { message } from "pkg";
export default { fetch() { return new Response(message); } };
`
      },
      packageFiles: {
        "node_modules/pkg/package.json": JSON.stringify({
          name: "pkg",
          exports: {
            ".": "../../../src/index.js"
          }
        }),
        "src/index.js": `export const message = "escaped package root";\n`
      }
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/outside package root|package root/i)
        })
      ])
    );
  });

  it("selects root conditional exports objects for package root imports", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import { message } from "root-conditional";
export default { fetch() { return new Response(message); } };
`
      },
      packageFiles: {
        "node_modules/root-conditional/package.json": JSON.stringify({
          name: "root-conditional",
          exports: {
            workerd: "./worker.js",
            default: "./index.js"
          }
        }),
        "node_modules/root-conditional/worker.js": `export const message = "worker export";\n`,
        "node_modules/root-conditional/index.js": `export const message = "default export";\n`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(build.modules?.["src/index.js"]).toContain("from \"/node_modules/root-conditional/worker.js\"");
    expect(build.modules).toHaveProperty("node_modules/root-conditional/worker.js");
    expect(build.modules).not.toHaveProperty("node_modules/root-conditional/index.js");

    const worker = loadDynamicWorker(workerEnv.LOADER, `pkg-root-conditional-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("worker export");
  });

  it("resolves a tiny ESM package from an in-memory node_modules snapshot", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import { message } from "pkg";
export default { fetch() { return new Response(message); } };
`
      },
      packageFiles: {
        "node_modules/pkg/package.json": JSON.stringify({
          name: "pkg",
          exports: {
            ".": {
              workerd: "./worker.js",
              default: "./index.js"
            }
          }
        }),
        "node_modules/pkg/worker.js": `import { suffix } from "./suffix.js";
export const message = "hello from package" + suffix;
`,
        "node_modules/pkg/suffix.js": `export const suffix = " resolver";
`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(Object.keys(build.modules ?? {}).sort()).toEqual([
      "node_modules/pkg/suffix.js",
      "node_modules/pkg/worker.js",
      "src/index.js"
    ]);
    expect(build.modules?.["src/index.js"]).toContain("from \"/node_modules/pkg/worker.js\"");
    expect(build.modules?.["node_modules/pkg/worker.js"]).toMatchObject({ js: expect.stringContaining("from \"./suffix.js\"") });

    const worker = loadDynamicWorker(workerEnv.LOADER, `pkg-esm-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("hello from package resolver");
  });

  it("rejects package modules that collide with local output paths", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import "./../node_modules/pkg/worker";
import { message } from "pkg";
export default { fetch() { return new Response(message); } };
`,
        "node_modules/pkg/worker.ts": `export const local = "first-party";\n`
      },
      packageFiles: {
        "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", exports: "./worker.js" }),
        "node_modules/pkg/worker.js": `export const message = "package";\n`
      }
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "internal",
        kind: "transform-failed",
        message: expect.stringMatching(/package module collision|overwrite/i)
      })
    );
  });

  it("rejects package modules that collide with virtual module output paths", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import { local } from "node_modules/pkg/worker";
import { message } from "pkg";
export default { fetch() { return new Response(local + message); } };
`
      },
      virtualModules: {
        "node_modules/pkg/worker": `export const local = "virtual";\n`
      },
      packageFiles: {
        "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", exports: "./worker.js" }),
        "node_modules/pkg/worker.js": `export const message = "package";\n`
      }
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "internal",
        kind: "transform-failed",
        message: expect.stringMatching(/package module collision|overwrite/i)
      })
    );
  });

  it("rewrites literal CJS package requires to explicit Worker Loader paths", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import cjsPkg from "cjs-pkg";
export default { fetch() { return new Response(cjsPkg.message); } };
`
      },
      packageFiles: {
        "node_modules/cjs-pkg/package.json": JSON.stringify({
          name: "cjs-pkg",
          main: "index.cjs"
        }),
        "node_modules/cjs-pkg/index.cjs": `const dep = require("dep-pkg");
exports.message = "cjs " + dep.message;
`,
        "node_modules/dep-pkg/package.json": JSON.stringify({
          name: "dep-pkg",
          main: "main.cjs"
        }),
        "node_modules/dep-pkg/main.cjs": `exports.message = "dependency";
`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(build.modules?.["node_modules/cjs-pkg/index.cjs"]).toEqual({
      cjs: `const dep = require("/node_modules/dep-pkg/main.cjs");
exports.message = "cjs " + dep.message;
`
    });

    const worker = loadDynamicWorker(workerEnv.LOADER, `pkg-cjs-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("cjs dependency");
  });

  it("returns source locations for dynamic package requires", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import value from "dynamic-cjs";
export default { fetch() { return new Response(String(value)); } };
`
      },
      packageFiles: {
        "node_modules/dynamic-cjs/package.json": JSON.stringify({
          name: "dynamic-cjs",
          main: "index.cjs"
        }),
        "node_modules/dynamic-cjs/index.cjs": `const name = "./dep.cjs";
module.exports = require(name);
`,
        "node_modules/dynamic-cjs/dep.cjs": `module.exports = "dep";
`
      }
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "internal",
        kind: "transform-failed",
        message: expect.stringContaining("Dynamic require is not supported"),
        file: "node_modules/dynamic-cjs/index.cjs",
        line: 2,
        column: 18,
        span: { start: 43, end: 51 }
      })
    );
  });

  it("returns source locations for missing literal CJS package requires", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import value from "missing-cjs";
export default { fetch() { return new Response(String(value)); } };
`
      },
      packageFiles: {
        "node_modules/missing-cjs/package.json": JSON.stringify({ name: "missing-cjs", main: "index.cjs" }),
        "node_modules/missing-cjs/index.cjs": `const dep = require("./missing.cjs");
exports.value = dep.value;
`
      }
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "internal",
        kind: "transform-failed",
        message: expect.stringContaining("Could not resolve ./missing.cjs required by package module node_modules/missing-cjs/index.cjs"),
        file: "node_modules/missing-cjs/index.cjs",
        line: 1,
        column: 21,
        span: { start: 20, end: 35 }
      })
    );
  });

  it("returns source locations for missing ESM package imports", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import { message } from "missing-esm";
export default { fetch() { return new Response(message); } };
`
      },
      packageFiles: {
        "node_modules/missing-esm/package.json": JSON.stringify({ name: "missing-esm", exports: "./index.js" }),
        "node_modules/missing-esm/index.js": `import { value } from "./missing.js";
export const message = value;
`
      }
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "internal",
        kind: "transform-failed",
        message: expect.stringContaining("Could not resolve ./missing.js imported by package module node_modules/missing-esm/index.js"),
        file: "node_modules/missing-esm/index.js",
        line: 1,
        column: 23,
        span: { start: 22, end: 36 }
      })
    );
  });

  it("returns source locations for dynamic ESM package imports", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import { message } from "dynamic-esm";
export default { fetch() { return new Response(message); } };
`
      },
      packageFiles: {
        "node_modules/dynamic-esm/package.json": JSON.stringify({ name: "dynamic-esm", exports: "./index.js" }),
        "node_modules/dynamic-esm/index.js": `export const message = String(import("./dep.js"));
`,
        "node_modules/dynamic-esm/dep.js": `export const dep = "dep";
`
      }
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "internal",
        kind: "transform-failed",
        message: expect.stringContaining("Dynamic imports are not supported in package modules: node_modules/dynamic-esm/index.js"),
        file: "node_modules/dynamic-esm/index.js",
        line: 1,
        column: 38,
        span: { start: 37, end: 47 }
      })
    );
  });
});
