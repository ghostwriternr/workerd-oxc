# workers-tsx-toolchain-spike

Experimental package for answering one narrow question:

> Can Oxc / Rolldown / Vite / VoidZero-family tooling run **inside Cloudflare Workers/workerd** as a replacement-style compiler for React/TSX Dynamic Workers?

The answer is now Oxc-first: `src/oxc/` contains the active parser, full-AST materializer, transform, local module graph, and constrained package snapshot work. `src/experiments/` keeps Babel as a low-footprint AST control/fallback, SWC as archived heavy parse+transform evidence, and Rolldown/Vite classification as blocked/non-runtime context.

This is intentionally **not** an esbuild spike. It uses Worker Loader as the target module shape:

```ts
{
  mainModule: "bundle.js",
  modules: { "bundle.js": "export default { fetch() { ... } }" },
  compatibilityDate: "2026-06-30"
}
```

## API

The focused workflow API is:

```ts
import {
  compileDynamicWorker,
  checkReactTsx,
  loadDynamicWorker,
  toLoaderDefinition,
} from "workers-tsx-toolchain-spike";

const build = await compileDynamicWorker({
  entrypoint: "src/index.tsx",
  files: {
    "src/index.tsx": `
      export default {
        async fetch() {
          return new Response("hello from compiled worker")
        }
      }
    `,
  },
  virtualModules: {
    // Optional exact bare-module keys supplied by the caller.
    // JS values may be shorthand strings or explicit { js } modules.
    // Leaf object modules may use { json }, { text }, { data }, or { wasm }.
    // Imports are rewritten to absolute Worker Loader module paths.
    "react/jsx-runtime": {
      js: `
        export function jsx(type, props) { return { type, props } }
        export const jsxs = jsx
        export const Fragment = Symbol.for("react.fragment")
      `,
    },
  },
});

if (build.ok) {
  const worker = loadDynamicWorker(env.LOADER, "my-worker", build, {
    compatibilityDate: "2026-06-30",
  });
  return worker.getEntrypoint().fetch(request);
}

console.log(build.diagnostics, build.evidence);
```

### `compileDynamicWorker(input)`

Attempts to turn a workerd-targeted React/TSX Worker project into Worker Loader modules.

Current active path:

1. Custom `oxc-parser` and `oxc-transform` WASI wrappers using `@alexbruf/wasmkernel` for local relative Worker module graphs and constrained package snapshots.
2. Rolldown is not called by this public workflow; `@rolldown/browser` remains archived experiment evidence because its published bootstrap is blocked in workerd before plugin hooks run.

The Oxc transform path uses the Oxc parser during graph discovery, resolves local relative files from `input.files`, accepts caller-provided `virtualModules` as exact bare-module keys (`string | { js } | { json } | { text } | { data } | { wasm }`), rewrites specifiers to emitted Worker Loader module keys, transforms each reachable source file, and returns a Worker Loader module map. JS virtual modules may import other virtual modules. Non-JS virtual object modules are emitted as leaf Worker Loader object modules; the builder does not scan or transform them. Type-only imports/exports are ignored for runtime graph purposes. Runtime external specifiers such as `cloudflare:*` are left unchanged. Bare/npm imports are resolved only when they are exact caller-provided `virtualModules` or when they are present in a constrained in-memory `packageFiles` snapshot. The package resolver handles package export targets with a small condition list (`workerd`, `worker`, `browser`, `import`, `require`, `default`), rewrites static ESM imports and literal CJS `require()` calls to explicit Worker Loader specifiers, emits package JS/CJS files under `node_modules/<package>/...` keys, and rejects unsupported shapes with diagnostics. Post-transform import rewriting is parser-driven so ordinary string literals are not changed.

Failures are returned as structured diagnostics because the failures are the evidence. Common graph/import failures now include source-aware `file`, 1-based `line`, 1-based `column`, and `span: { start, end }` fields. Local graph diagnostics point to the original caller source. Post-transform validation diagnostics use Oxc transform source maps internally when the generated position has a real original mapping; otherwise they fall back to emitted module source. Oxc's injected automatic `react/jsx-runtime` import line is currently unmapped, so missing-runtime diagnostics still point at generated JS. Public source-map output and runtime stack mapping remain future work.

### `checkReactTsx(source | input)`

Development-loop syntax check for TSX source using Oxc parser through `@alexbruf/wasmkernel` inside workerd. This API is not type checking and intentionally returns diagnostics/evidence only; full Oxc `Program` AST access is available through the internal materializer below, which reads the raw one-shot `result.program` JSON exactly once.

### Experimental AST helpers

`src/experiments/babel-ast.ts` contains an internal experimental helper for structural TSX full-AST needs:

```ts
import { experimentalParseReactTsxAst } from "./src/experiments/babel-ast";

const result = experimentalParseReactTsxAst(source, "component.tsx");
if (result.ok) {
  console.log(result.ast.type); // "File" - Babel AST flavor
}
```

It parses TSX with Babel parser inside workerd using `sourceType: "module"` and the `typescript` + `jsx` plugins. It returns structured diagnostics instead of throwing on parse failure and preserves source locations, Babel source ranges, comments, and tokens for structural editing experiments.

`src/oxc/ast.ts` contains an internal Oxc AST materializer:

```ts
import { experimentalParseReactTsxAstWithOxc } from "./src/oxc/ast";

const result = await experimentalParseReactTsxAstWithOxc(source, "component.tsx");
if (result.ok) {
  console.log(result.ast.type); // "Program" - Oxc/ESTree-style AST
  console.log(result.rawProgramLength); // bytes of one-shot raw AST JSON
}
```

The raw Oxc binding exposes `result.program` as a one-shot JSON string. The helper reads it exactly once, parses Oxc's `{ node, fixes }` payload, applies the same BigInt/RegExp literal fixes as `oxc-parser/src-js/wrap.js`, and returns structured diagnostics/evidence.

`src/experiments/swc.ts` contains a separate internal SWC wasm-web parse+transform spike:

```ts
import { experimentalParseTransformReactTsxWithSwc } from "./src/experiments/swc";

const result = experimentalParseTransformReactTsxWithSwc(source, "component.tsx", {
  transformFromAst: true,
});
if (result.ok) {
  console.log(result.ast.type); // "Module" - SWC AST flavor
  console.log(result.code); // ESM JS with automatic React runtime imports
}
```

It initializes `@swc/wasm-web` from an imported Worker `WebAssembly.Module`, parses TSX into an SWC AST, and transforms TSX to automatic-runtime ESM JavaScript. These helpers are deliberately not part of the package's public workflow API yet, and SWC is not wired into `compileDynamicWorker()`.

### Experimental build sessions

`experimentalCreateDynamicWorkerBuildSession(input)` provides a public-but-experimental edit-loop wrapper around the Oxc-first compiler path:

```ts
import { experimentalCreateDynamicWorkerBuildSession } from "workers-tsx-toolchain-spike";

const session = experimentalCreateDynamicWorkerBuildSession(input);
const first = await session.compile();

session.updateFile("src/component.tsx", nextSource);
const second = await session.compile();

if (!second.ok) {
  // Failed compiles do not replace the last successful build.
  const lastGood = session.getLastSuccessfulBuild();
  console.log(lastGood?.mainModule);
}
```

The session tracks revisions and dirty metadata for first-party files, virtual modules, and in-memory package snapshot files. It also returns defensive copies from `snapshotInput()` and `getLastSuccessfulBuild()` so callers cannot mutate internal session state by accident. Compile results include experimental cache metadata such as `transformedModules`, `reusedModules`, `droppedModules`, `graphRebuilt`, and `packageGraphRebuilt`.

Session compiles now reuse unchanged transformed local-module and virtual-JS-module output when the rewritten source and resolution context are unchanged. They also cache Oxc module-specifier scan metadata for unchanged reachable files, so leaf edits do not need to reparse every file during graph discovery. The session still emits a complete Worker Loader module map on every successful compile because Dynamic Workers do not support partial module-map updates. Worker Loader also caches by ID, so changed code should use a new revision/hash-based ID when passed to `env.LOADER.get(id, callback)`. This cache reduces builder compile latency; it does not remove Dynamic Worker startup parsing/compilation for a newly loaded ID/code pair. The experimental API name is intentional: later work can refine dependency-aware invalidation and package graph caching behind the same shape without making the current metadata stable.

### `hashDynamicWorkerBuild(build)` / `dynamicWorkerBuildId(prefix, build)`

Helpers for matching Worker Loader's ID-based cache model. Cloudflare's Dynamic Worker docs require callers to use a new ID when code changes; these helpers hash the complete `mainModule + modules` content so callers can derive revision/hash-based IDs only when they need them:

```ts
import { dynamicWorkerBuildId, loadDynamicWorker } from "workers-tsx-toolchain-spike";

const build = await session.compile();
if (build.ok) {
  const worker = loadDynamicWorker(
    env.LOADER,
    dynamicWorkerBuildId("project-a", build),
    build,
    { compatibilityDate: "2026-06-30" },
  );
}
```

The hash is deterministic across module insertion order, canonicalizes JSON object key order, includes object module type tags and `ArrayBuffer` bytes, and throws `TypeError` for failed or incomplete builds. It is a workerd-safe pure TypeScript helper, not a cryptographic security primitive.

### `toLoaderDefinition(build)` / `loadDynamicWorker(loader, id, build)`

Helpers for turning successful output into the Dynamic Workers / Worker Loader shape and invoking `env.LOADER.get(id, ...)`.

## Fixtures

The package exports the required fixtures:

```ts
import {
  TSX_COMPONENT_FIXTURE,
  WORKER_ENTRY_FIXTURE,
  REACT_WORKER_FIXTURE,
} from "workers-tsx-toolchain-spike";
```

## Tests

```sh
npm test
npm run typecheck
npm run test:node
npm run test:workers
npm run test:operational
npm run test:session-cache
npm run test:bundle-shape
npm run test:startup
npm run test:risk
```

The Workers tests use `@cloudflare/vitest-pool-workers` with this `wrangler.jsonc` binding:

```jsonc
{
  "worker_loaders": [{ "binding": "LOADER" }]
}
```

The tests prove:

- the Worker Loader binding itself can load a control module shape;
- Worker Loader JS can import control `{ json }`, `{ text }`, `{ data }`, and `{ wasm }` object modules;
- Workers can import `.wasm` as a precompiled `WebAssembly.Module` and instantiate it;
- Workers reject runtime `WebAssembly.compile(bytes)`, matching the documented security model;
- the package can be imported and executed inside workerd;
- Oxc parser and transform can run through `@alexbruf/wasmkernel` inside workerd for narrow TS/TSX Worker entries;
- Node `oxc-parser` returns a full TSX `Program` AST, and the raw workerd/wasmkernel parser path returns a one-shot serialized `program` JSON string; the internal `experimentalParseReactTsxAstWithOxc()` helper materializes that JSON into a full Oxc/ESTree-style `Program` and applies Oxc's BigInt/RegExp literal fixes;
- alternate full-AST controls are positive: `@babel/parser@8.0.0` returns a full Babel TSX AST inside workerd, the internal `experimentalParseReactTsxAst()` helper wraps it with diagnostics plus ranges/comments/tokens, and `@swc/wasm-web@1.15.43` initializes from an imported `WebAssembly.Module`; the internal `experimentalParseTransformReactTsxWithSwc()` helper parses TSX into an SWC AST and transforms TSX from either source or the parsed AST, but SWC remains archived spike evidence because of its bundle shape;
- local relative multi-module graphs can be discovered through Oxc-backed graph metadata, transformed into Worker Loader modules, and loaded successfully;
- `experimentalCreateDynamicWorkerBuildSession()` provides an edit-loop wrapper with revision/dirty metadata, file/virtual/package mutation methods, defensive snapshots, last-successful-build preservation across failed compiles, builder-side reuse of unchanged transformed module outputs, and graph-specifier scan reuse for unchanged reachable files;
- `hashDynamicWorkerBuild()` and `dynamicWorkerBuildId()` provide deterministic content hashes and revision-style Worker Loader IDs for complete Dynamic Worker module maps;
- `npm run test:session-cache` records local workerd/Vitest timing signals comparing cold `compileDynamicWorker()` with session initial compiles, cached leaf updates, graph updates, and package snapshot updates for generated module graphs, including graph scanned/reused module counts;
- caller-provided virtual bare modules (`string` shorthand, `{ js }`, `{ json }`, `{ text }`, `{ data }`, or `{ wasm }`) can satisfy imports such as `react/jsx-runtime`, including automatic JSX output from Oxc transform; JS virtual modules can import other virtual modules, and object modules are emitted as leaf Worker Loader modules;
- actual React 19.2.7 / React DOM 19.2.7 CJS production package files can server-render through Worker Loader without bundling both as a manual `{ cjs }` control map and as resolver-produced output from an exact in-memory `packageFiles` snapshot; the constrained resolver selects the `workerd` server export and rewrites literal `require("react")` / `require("react-dom")` calls to explicit Worker Loader module specifiers;
- 10-module and 50-module local graph stress cases compile successfully in workerd, with timing output available from the stress test;
- `npm run test:operational` records local workerd/Vitest timing signals for SWC source transforms, SWC transform-from-AST, parse-error recovery, the current Oxc compile stress path, and cached session compiles; these are not production benchmarks;
- `npm run test:bundle-shape` runs Wrangler dry-run builds for tiny Babel, SWC, Oxc check, Oxc AST, and Oxc transform fixture Workers and records Wrangler-reported upload/gzip sizes plus `wrangler check startup` alpha-command signals;
- `npm run test:startup` runs the bundle/startup-shape checks plus Oxc-specific Workers timing probes for full AST materialization, repeated 10-module compiles, and parse-failure recovery;
- `npm run test:risk` records raw/gzip artifact-size proxies, Wrangler dry-run bundle/startup-shape signals, and local workerd memory-observability signals; raw package artifact sizes and dry-run upload sizes are not production cold-start or RSS measurements, and local `process.memoryUsage()` currently reports zero-valued fields rather than meaningful RSS;
- missing local imports, unsupported dynamic imports, unsupported bare imports, and supported package graph failures return structured diagnostics with source locations where the builder has parser/require scanner offsets; post-transform diagnostics use Oxc source maps only when the generated position is actually mapped, and otherwise fall back to generated module locations;
- Oxc runtime failures are structured diagnostics, not crashes; Rolldown blocked-runtime behavior remains covered as experiment evidence rather than the active compile path;
- failed compiler output cannot be accidentally passed to Worker Loader or hashed into a Dynamic Worker build ID;
- Worker Loader error-surface controls show that syntax errors, missing imports, top-level throws, and invalid CJS main modules surface when the stub receives `fetch()`, not at `LOADER.get()`; current local workerd/Vitest startup messages include generated module context, but this package does not yet expose runtime-error mapping;
- Vite, rolldown-vite, Oxlint, and Oxfmt are classified as development/build/CLI tooling rather than workerd runtime builder APIs.

## Current result

This spike now proves an Oxc-first positive path: `oxc-parser` and `oxc-transform` WASI binaries can be loaded inside workerd via `@alexbruf/wasmkernel`; Oxc can materialize a full TSX AST from the raw one-shot `program` JSON string; and Oxc transform can compile a local relative TS/TSX Worker module graph into a multi-module Worker Loader map.

That is still **not** a complete compiler/bundler for arbitrary React Workers. Rolldown is not running in workerd, and the graph layer intentionally does not fetch npm packages, implement full Node resolution, bundle arbitrary dependencies, process CSS/assets/import-url pipelines, handle dynamic imports/requires, or provide broad React package semantics. The Oxc raw wasmkernel parser path does provide full TSX AST access, but at the raw binding layer `result.program` is a one-shot serialized JSON string consumed by its getter; code must read it exactly once and materialize it with Oxc's wrapper logic. Separate control tests also prove full AST alternatives exist: `@babel/parser` remains the recommended low-friction path for structural TSX structural TSX analysis, and the internal `experimentalParseReactTsxAst()` helper provides a small diagnostics-oriented wrapper for it. `@swc/wasm-web` works functionally, but its Wrangler dry-run bundle shape makes it archived spike evidence rather than a near-term default. `virtualModules` is a primitive for caller-supplied exact bare modules and leaf object modules, not npm resolution. A constrained in-memory `packageFiles` resolver can now emit exact package snapshots with a small export-condition list and literal import/require rewrites, and it has a positive React 19.2.7 production SSR control path. Worker Loader control tests now prove `{ json }`, `{ text }`, `{ data }`, `{ wasm }`, and `{ cjs }` module imports work in the relevant shapes. Worker Loader does not by itself resolve arbitrary bare CommonJS package requires. The broad `es-module-lexer`/regex TSX scanner has been removed; graph discovery now depends on successful Oxc parsing and Oxc module metadata, with parser-validated extraction for export-from and dynamic-import specifiers where the raw NAPI metadata is incomplete. The vendored guest binaries at `src/wasm/oxc-parser.wasm.bin` and `src/wasm/oxc-transform.wasm.bin` come from `@oxc-parser/binding-wasm32-wasi@0.137.0` and `@oxc-transform/binding-wasm32-wasi@0.137.0`; they are imported as Wrangler `Data` modules because wasmkernel needs raw bytes, while `@alexbruf/wasmkernel/wasmkernel.wasm` is imported as a precompiled `WebAssembly.Module`.

This is **not** because Workers lack Wasm support. Workers support imported `.wasm` modules as precompiled `WebAssembly.Module` values. The issue with the investigated packages' published browser glue is runtime wasm fetch/compile from `import.meta.url` and browser worker-thread style NAPI/WASI machinery. The custom wasmkernel wrappers bypass that for Oxc parser and transform.

See [`FINDINGS.md`](./FINDINGS.md) for details.
