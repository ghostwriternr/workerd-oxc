import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import {
  dynamicWorkerBuildId,
  hashDynamicWorkerBuild,
  loadDynamicWorker,
} from "../../src/index";
import type { DynamicWorkerModules, ReactWorkerBuildOutput, WorkerLoaderBinding } from "../../src/types";

interface Env {
  LOADER: WorkerLoaderBinding;
}

const workerEnv = env as unknown as Env;

function buildWithModules(modules: DynamicWorkerModules["modules"]): DynamicWorkerModules {
  return {
    mainModule: "index.js",
    modules,
  };
}

describe("Dynamic Worker build IDs", () => {
  test("hashes equivalent module maps deterministically regardless of insertion order", () => {
    const left = buildWithModules({
      "index.js": `import { value } from "./dep.js"; export default { fetch() { return new Response(value) } }`,
      "dep.js": `export const value = "same";`,
    });
    const right = buildWithModules({
      "dep.js": `export const value = "same";`,
      "index.js": `import { value } from "./dep.js"; export default { fetch() { return new Response(value) } }`,
    });

    expect(hashDynamicWorkerBuild(left)).toMatch(/^[0-9a-f]{16}$/);
    expect(hashDynamicWorkerBuild(left)).toBe(hashDynamicWorkerBuild(right));
    expect(dynamicWorkerBuildId("project-a", left)).toBe(`project-a:${hashDynamicWorkerBuild(left)}`);
  });

  test("changes hashes when module content changes", () => {
    const first = buildWithModules({ "index.js": `export default { fetch() { return new Response("one") } }` });
    const second = buildWithModules({ "index.js": `export default { fetch() { return new Response("two") } }` });

    expect(hashDynamicWorkerBuild(first)).not.toBe(hashDynamicWorkerBuild(second));
    expect(dynamicWorkerBuildId("project-a", first)).not.toBe(dynamicWorkerBuildId("project-a", second));
  });

  test("canonicalizes JSON module object key order", () => {
    const left = buildWithModules({
      "index.js": `import config from "./config.json"; export default { fetch() { return Response.json(config) } }`,
      "config.json": { json: { b: 2, a: 1 } },
    });
    const right = buildWithModules({
      "index.js": `import config from "./config.json"; export default { fetch() { return Response.json(config) } }`,
      "config.json": { json: { a: 1, b: 2 } },
    });

    expect(hashDynamicWorkerBuild(left)).toBe(hashDynamicWorkerBuild(right));
  });

  test("includes object module type tags and content in the hash", () => {
    const firstJs = buildWithModules({ "index.js": { js: `export default { fetch() { return new Response("one") } }` } });
    const secondJs = buildWithModules({ "index.js": { js: `export default { fetch() { return new Response("two") } }` } });
    const cjs = buildWithModules({ "index.js": { cjs: `module.exports = { fetch() { return new Response("one") } }` } });
    const text = buildWithModules({ "index.js": `export default { fetch() { return new Response("ok") } }`, "message.txt": { text: "one" } });
    const changedText = buildWithModules({ "index.js": `export default { fetch() { return new Response("ok") } }`, "message.txt": { text: "two" } });
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const changedBytes = new Uint8Array([1, 2, 4]).buffer;
    const data = buildWithModules({ "index.js": `export default { fetch() { return new Response("ok") } }`, "data.bin": { data: bytes } });
    const changedData = buildWithModules({ "index.js": `export default { fetch() { return new Response("ok") } }`, "data.bin": { data: changedBytes } });
    const wasm = buildWithModules({ "index.js": `export default { fetch() { return new Response("ok") } }`, "module.wasm": { wasm: bytes } });

    expect(hashDynamicWorkerBuild(firstJs)).not.toBe(hashDynamicWorkerBuild(secondJs));
    expect(hashDynamicWorkerBuild(firstJs)).not.toBe(hashDynamicWorkerBuild(cjs));
    expect(hashDynamicWorkerBuild(text)).not.toBe(hashDynamicWorkerBuild(changedText));
    expect(hashDynamicWorkerBuild(data)).not.toBe(hashDynamicWorkerBuild(changedData));
    expect(hashDynamicWorkerBuild(data)).not.toBe(hashDynamicWorkerBuild(wasm));
  });

  test("rejects failed and incomplete build outputs", () => {
    const failed: ReactWorkerBuildOutput = {
      ok: false,
      diagnostics: [],
      evidence: [],
      toolchain: { loaderTarget: "none" },
    };
    const noMain = { ok: true, modules: { "index.js": "" }, diagnostics: [], evidence: [], toolchain: { loaderTarget: "worker-loader" as const } };
    const noModules = { ok: true, mainModule: "index.js", diagnostics: [], evidence: [], toolchain: { loaderTarget: "worker-loader" as const } };
    const missingMain = { ok: true, mainModule: "missing.js", modules: { "index.js": "" }, diagnostics: [], evidence: [], toolchain: { loaderTarget: "worker-loader" as const } };

    expect(() => hashDynamicWorkerBuild(failed)).toThrow(TypeError);
    expect(() => dynamicWorkerBuildId("project-a", failed)).toThrow(TypeError);
    expect(() => hashDynamicWorkerBuild(noMain)).toThrow(TypeError);
    expect(() => hashDynamicWorkerBuild(noModules)).toThrow(TypeError);
    expect(() => hashDynamicWorkerBuild(missingMain)).toThrow(TypeError);
  });

  test("rejects malformed module content and unsupported JSON values", () => {
    expect(() => hashDynamicWorkerBuild(buildWithModules({ "index.js": { js: undefined, text: "real" } as never }))).toThrow(TypeError);
    expect(() => hashDynamicWorkerBuild(buildWithModules({ "index.js": `export default {}`, "config.json": { json: { a: undefined } } }))).toThrow(TypeError);
    expect(() => hashDynamicWorkerBuild(buildWithModules({ "index.js": `export default {}`, "config.json": { json: new Date(0) } }))).toThrow(TypeError);
    expect(() => hashDynamicWorkerBuild(buildWithModules({ "index.js": `export default {}`, "config.json": { json: Number.POSITIVE_INFINITY } }))).toThrow(TypeError);
    expect(() => dynamicWorkerBuildId("bad prefix", buildWithModules({ "index.js": `export default {}` }))).toThrow(TypeError);
  });

  test("generates IDs usable with Worker Loader", async () => {
    const build = buildWithModules({
      "index.js": `export default { fetch() { return new Response("hashed loader ok") } }`,
    });
    const worker = loadDynamicWorker(workerEnv.LOADER, dynamicWorkerBuildId("build-id-test", build), {
      ok: true,
      mainModule: build.mainModule,
      modules: build.modules,
      diagnostics: [],
      evidence: [],
      toolchain: { loaderTarget: "worker-loader" },
    }, {
      compatibilityDate: "2026-06-30",
    });

    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("hashed loader ok");
  });
});
