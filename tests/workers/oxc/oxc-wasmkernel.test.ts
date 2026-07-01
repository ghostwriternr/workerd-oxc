import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { checkReactTsx, compileDynamicWorker, compileTsx, loadDynamicWorker, TSX_COMPONENT_FIXTURE } from "../../../src/index";
import type { WorkerLoaderBinding } from "../../../src/types";

interface Env {
  LOADER: WorkerLoaderBinding;
}

const workerEnv = env as unknown as Env;

let id = 0;

describe("Oxc parser/transform through wasmkernel in workerd", () => {
  it("checks valid TSX with Oxc parser through wasmkernel", async () => {
    const result = await checkReactTsx(TSX_COMPONENT_FIXTURE);

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        tool: "oxc-parser",
        stage: "import",
        ok: true,
        detail: expect.stringContaining("wasmkernel")
      })
    );
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        tool: "oxc-parser",
        stage: "parse",
        ok: true,
        detail: "0 parser errors"
      })
    );
  });

  it("returns Oxc parser diagnostics for invalid TSX", async () => {
    const result = await checkReactTsx(`export const = ;`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "oxc-parser",
        kind: "parse-failed"
      })
    );
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        tool: "oxc-parser",
        stage: "parse",
        ok: false
      })
    );
  });

  it("transforms a local relative TSX module graph into Dynamic Worker modules", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `import { message } from "./message";

export default {
  fetch() {
    return new Response(message);
  }
};
`,
        "src/message.ts": `export const message: string = "hello from local graph";
`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(build.mainModule).toBe("src/index.js");
    expect(Object.keys(build.modules ?? {}).sort()).toEqual(["src/index.js", "src/message.js"]);
    expect(build.modules?.["src/index.js"]).toContain("from \"./message.js\"");
    expect(build.modules?.["src/message.js"]).toContain("hello from local graph");
    expect(build.modules?.["src/message.js"]).not.toContain(": string");

    const worker = loadDynamicWorker(workerEnv.LOADER, `oxc-graph-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("hello from local graph");
  });

  it("uses Oxc parser metadata so type-only relative imports do not become runtime modules", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `import type { MissingType } from "./types";
export type { OtherMissingType } from "./other-types";

const value: MissingType | null = null;
export default {
  fetch() {
    return new Response(value === null ? "type-only ignored" : "unexpected");
  }
};
`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(Object.keys(build.modules ?? {})).toEqual(["src/index.js"]);
    expect(build.modules?.["src/index.js"]).not.toContain("./types");
    expect(build.modules?.["src/index.js"]).not.toContain("./other-types");

    const worker = loadDynamicWorker(workerEnv.LOADER, `oxc-types-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("type-only ignored");
  });

  it("ignores type-only export-from declarations when building the runtime graph", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `export { type MissingType } from "./types";
export default { fetch() { return new Response("type export ignored"); } };
`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(Object.keys(build.modules ?? {})).toEqual(["src/index.js"]);
    expect(build.modules?.["src/index.js"]).not.toContain("./types");

    const worker = loadDynamicWorker(workerEnv.LOADER, `oxc-type-export-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("type export ignored");
  });

  it("ignores import-like text in strings and comments when building the graph", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `const text = "import('./not-real')";
// export { value } from "./commented";
/* export * from "./block-commented"; */
export default { fetch() { return new Response(text); } };
`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(Object.keys(build.modules ?? {})).toEqual(["src/index.js"]);

    const worker = loadDynamicWorker(workerEnv.LOADER, `oxc-comment-scan-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("import('./not-real')");
  });

  it("rejects non-literal dynamic imports", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `const name = "message";
export default { async fetch() { return new Response(String(await import("./" + name))); } };
`
      }
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "oxc-transform",
        kind: "transform-failed",
        message: expect.stringContaining("Dynamic imports are not supported")
      })
    );
  });

  it("resolves side-effect imports and export-from declarations", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import "./setup";
import { message } from "./reexports";
export default { fetch() { return new Response(globalThis.prefix + message); } };
`,
        "src/reexports.ts": `export { message } from "./message";
`,
        "src/setup.ts": `globalThis.prefix = "side effect: ";
`,
        "src/message.ts": `export const message: string = "exported";
`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(Object.keys(build.modules ?? {}).sort()).toEqual(["src/index.js", "src/message.js", "src/reexports.js", "src/setup.js"]);
    expect(build.modules?.["src/index.js"]).toContain("\"./setup.js\"");
    expect(build.modules?.["src/index.js"]).toContain("from \"./reexports.js\"");
    expect(build.modules?.["src/reexports.js"]).toContain("from \"./message.js\"");

    const worker = loadDynamicWorker(workerEnv.LOADER, `oxc-export-from-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("side effect: exported");
  });

  it("returns source locations for dynamic import diagnostics", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `export default {
  async fetch() {
    return new Response(String(await import("./message")));
  }
};
`,
        "src/message.ts": `export const message = "dynamic";
`
      }
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "oxc-transform",
        kind: "transform-failed",
        message: expect.stringContaining("Dynamic imports are not supported"),
        file: "src/index.ts",
        line: 3,
        column: 45,
        span: { start: 79, end: 90 }
      })
    );
  });

  it("returns source locations for missing local relative imports", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `const ok = true;
import { message } from "./missing";
export default { fetch() { return new Response(message); } };
`
      }
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "oxc-transform",
        kind: "transform-failed",
        message: expect.stringContaining("Could not resolve ./missing imported by src/index.ts"),
        file: "src/index.ts",
        line: 2,
        column: 25,
        span: { start: 41, end: 52 }
      })
    );
  });

  it("resolves explicit user-provided virtual bare modules", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import { message } from "app/config";
export default { fetch() { return new Response(message); } };
`
      },
      virtualModules: {
        "app/config": `export const message = "hello from virtual module";
`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(Object.keys(build.modules ?? {}).sort()).toEqual(["app/config.js", "src/index.js"]);
    expect(build.modules?.["src/index.js"]).toContain("from \"/app/config.js\"");

    const worker = loadDynamicWorker(workerEnv.LOADER, `oxc-virtual-bare-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("hello from virtual module");
  });

  it("resolves typed virtual JS modules that import other virtual modules", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import { message } from "app/config";
export default { fetch() { return new Response(message); } };
`
      },
      virtualModules: {
        "app/config": {
          js: `import { base } from "app/base";
export const message = base + " config";
`
        },
        "app/base": {
          js: `export const base = "typed virtual";
`
        }
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(Object.keys(build.modules ?? {}).sort()).toEqual(["app/base.js", "app/config.js", "src/index.js"]);
    const configModule = build.modules?.["app/config.js"];
    expect(typeof configModule).toBe("object");
    expect(typeof configModule === "object" && configModule !== null && "js" in configModule ? configModule.js : "").toContain("from \"/app/base.js\"");

    const worker = loadDynamicWorker(workerEnv.LOADER, `oxc-typed-virtual-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("typed virtual config");
  });

  it("loads automatic JSX output through a user-provided virtual bare module", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `const view = <span>{"hello from virtual jsx"}</span>;

export default {
  fetch() {
    return new Response(view.props.children);
  }
};
`
      },
      virtualModules: {
        "react/jsx-runtime": `export function jsx(type, props) {
  return { type, props };
}
export const jsxs = jsx;
export const Fragment = Symbol.for("react.fragment");
`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(build.mainModule).toBe("src/index.js");
    expect(Object.keys(build.modules ?? {}).sort()).toEqual(["react/jsx-runtime.js", "src/index.js"]);
    expect(build.modules?.["src/index.js"]).toContain("from \"/react/jsx-runtime.js\"");
    expect(JSON.stringify(build.modules?.["react/jsx-runtime.js"])).toContain("function jsx");

    const worker = loadDynamicWorker(workerEnv.LOADER, `oxc-virtual-jsx-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("hello from virtual jsx");
  });

  it("resolves automatic JSX runtime imports from package files after transform", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `const view = <span>{"hello from package jsx"}</span>;
export default { fetch() { return new Response(view.props.children); } };
`
      },
      packageFiles: {
        "node_modules/react/package.json": JSON.stringify({
          name: "react",
          exports: {
            "./jsx-runtime": { workerd: "./jsx-runtime.js", default: "./index.js" }
          }
        }),
        "node_modules/react/jsx-runtime.js": `export function jsx(type, props) { return { type, props }; }
export const jsxs = jsx;
export const Fragment = Symbol.for("react.fragment");
`,
        "node_modules/react/index.js": `export const unused = true;\n`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(build.modules?.["src/index.js"]).toContain("from \"/node_modules/react/jsx-runtime.js\"");
    expect(build.modules).toHaveProperty("node_modules/react/jsx-runtime.js");

    const worker = loadDynamicWorker(workerEnv.LOADER, `oxc-package-jsx-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("hello from package jsx");
  });

  it("returns generated source locations for transform-generated bare imports without virtual modules", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `const view = <span>{"missing runtime"}</span>;
export default { fetch() { return new Response(view.props.children); } };
`
      }
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "oxc-transform",
        kind: "transform-failed",
        message: expect.stringContaining("Bare import specifiers are not supported"),
        file: "src/index.js",
        line: expect.any(Number),
        column: expect.any(Number),
        span: expect.objectContaining({
          start: expect.any(Number),
          end: expect.any(Number)
        })
      })
    );
  });

  it("does not rewrite ordinary string literals that match virtual module names", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import { message } from "app/config";
const literal = "app/config";
export default { fetch() { return new Response(message + ":" + literal); } };
`
      },
      virtualModules: {
        "app/config": `export const message = "virtual";
`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(build.modules?.["src/index.js"]).toContain("from \"/app/config.js\"");
    expect(build.modules?.["src/index.js"]).toContain("literal = \"app/config\"");

    const worker = loadDynamicWorker(workerEnv.LOADER, `oxc-virtual-literal-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("virtual:app/config");
  });

  it("returns diagnostics for unsupported bare imports", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import { jsx } from "react/jsx-runtime";
export default { fetch() { return new Response(String(jsx)); } };
`
      }
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "oxc-transform",
        kind: "transform-failed",
        message: expect.stringContaining("Bare import specifiers are not supported")
      })
    );
  });

  it("preserves source spans through the compileTsx compatibility diagnostics", async () => {
    const result = await compileTsx({
      entry: "src/index.ts",
      files: {
        "src/index.ts": `const ok = true;
import { message } from "./missing";
export default { fetch() { return new Response(message); } };
`
      }
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        source: "oxc",
        severity: "error",
        message: expect.stringContaining("Could not resolve ./missing imported by src/index.ts"),
        file: "src/index.ts",
        line: 2,
        column: 25,
        span: { start: 41, end: 52 }
      })
    );
  });

  it("transforms a TSX Worker entry into Dynamic Worker modules", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.tsx",
      jsx: { runtime: "classic" },
      files: {
        "src/index.tsx": `const React = {
  createElement(_tag: string, _props: Record<string, unknown>, ...children: string[]) {
    return { text: children.join("") };
  }
};
const view = <span>{"hello from oxc wasmkernel"}</span>;
export default {
  fetch() {
    return new Response(view.text);
  }
};
`
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(build.toolchain.transformer).toBe("oxc-transform");
    expect(build.toolchain.loaderTarget).toBe("worker-loader");
    expect(build.mainModule).toBe("src/index.js");
    expect(build.modules?.["src/index.js"]).toContain("hello from oxc wasmkernel");
    expect(build.modules?.["src/index.js"]).toContain("React.createElement");
    expect(build.modules?.["src/index.js"]).not.toContain("<span>");
    expect(build.modules?.["src/index.js"]).not.toContain(": string");
    expect(build.evidence).toContainEqual(
      expect.objectContaining({
        tool: "oxc-transform",
        stage: "import",
        ok: true,
        detail: expect.stringContaining("wasmkernel")
      })
    );
    expect(build.evidence.some((event) => event.tool === "rolldown-browser")).toBe(false);

    const worker = loadDynamicWorker(workerEnv.LOADER, `oxc-wasmkernel-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("hello from oxc wasmkernel");
  });
});
