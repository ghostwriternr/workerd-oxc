# Findings: Oxc/Rolldown/Vite tooling inside workerd

Date: 2026-06-30

## Executive summary

This spike tested the relevant Oxc / Rolldown / Vite / VoidZero-family packages as possible runtime compiler infrastructure for a `@cloudflare/worker-bundler`-style package that runs **inside workerd** and emits modules for Dynamic Workers / Worker Loader.

The current conclusion is:

> Narrow Oxc parser and transform paths can run inside workerd through `@alexbruf/wasmkernel`, and transform can emit local relative TS/TSX Worker Loader module graphs, but none of the investigated Oxc/Rolldown/Vite-family packages is currently a drop-in workerd runtime replacement for `@cloudflare/worker-bundler`.

Important correction/clarification: Cloudflare Workers **do support WebAssembly**. The supported shape is importing `.wasm` / `.wasm?module` as a precompiled `WebAssembly.Module` and instantiating that module. The blockers in the published package glues are not “Wasm in Workers”; they are runtime wasm fetch/compile from `import.meta.url`, WASI threads, and dynamic Web Worker creation.

The positive result in this spike is a pair of custom wrappers: `@alexbruf/wasmkernel` accepts the precompiled `wasmkernel.wasm` module, accepts Oxc parser/transform guests as raw bytes, and exposes `napiModule.exports.parseSync` / `transformSync`. A small graph layer now uses Oxc parser-backed graph discovery, resolves local relative files, accepts caller-provided virtual bare modules (`string` shorthand, `{ js }`, `{ json }`, `{ text }`, `{ data }`, or `{ wasm }`), rewrites specifiers to emitted Worker Loader module keys, validates post-transform imports, and emits a multi-module Worker Loader map. JS virtual modules can import other virtual modules; non-JS virtual object modules are emitted as leaf modules. A constrained in-memory package resolver also handles exact `packageFiles` snapshots under `node_modules/<package>/...`, selects package exports from a small condition list (`workerd`, `worker`, `browser`, `import`, `require`, `default`), rewrites static ESM imports and literal CJS `require()` calls to explicit Worker Loader specifiers, and emits package JS/CJS modules. This is still transform-only plus constrained snapshot resolution: it does not fetch npm packages, implement full Node resolution, handle CSS/assets/import-url graphs, support dynamic imports/requires, run Rolldown, or provide broad React dependency semantics.

## Evidence from this package

Run:

```sh
npm run typecheck
npm test
```

Current passing evidence:

- Node metadata tests verify published package shape:
  - `@rolldown/browser` has browser exports and depends on `@napi-rs/wasm-runtime`.
  - `oxc-parser` and `oxc-transform` publish browser entries backed by `@oxc-*/binding-wasm32-wasi` optional dependencies.
  - `vite` and `rolldown-vite` export Node-facing `dist/node/index.js` APIs.
- Workers runtime tests verify:
  - Worker Loader works for a control `{ mainModule, modules }` shape.
  - Workers import `.wasm` as a precompiled `WebAssembly.Module` and instantiate it successfully.
  - Workers reject runtime `WebAssembly.compile(bytes)`, matching the documented security model.
  - `compileDynamicWorker()` runs inside workerd and can discover and transform local relative TS/TSX Worker module graphs through `@alexbruf/wasmkernel` + Oxc parser/transform.
  - `checkReactTsx()` runs inside workerd through `@alexbruf/wasmkernel` + Oxc parser, returning real parser success/failure evidence instead of published-glue unsupported diagnostics.
  - Full TSX AST access is available through the raw wasmkernel Oxc parser path if `result.program` is read exactly once: the raw getter returns a one-shot serialized JSON payload whose `node` is a `Program`; the internal `experimentalParseReactTsxAstWithOxc()` helper materializes it and applies Oxc's BigInt/RegExp fixes.
  - Type-only imports/exports are ignored for runtime graph purposes, caller-provided virtual bare modules (`string`, `{ js }`, `{ json }`, `{ text }`, `{ data }`, or `{ wasm }`) can satisfy imports like `react/jsx-runtime`, JS virtual modules can import each other, transform-generated unknown bare imports are rejected before Worker Loader, and missing local relative imports, dynamic imports, unsupported bare imports, and unsupported virtual module content shapes return structured diagnostics.
  - Worker Loader control tests prove JS can import `{ json }`, `{ text }`, `{ data }`, and `{ wasm }` object modules; builder tests prove `virtualModules` can emit those same object-module shapes as exact bare-module leaves.
  - Actual React 19.2.7 / React DOM 19.2.7 production CJS files can server-render through Worker Loader without bundling both as a manual `{ cjs }` module map and as resolver-produced output from an exact `packageFiles` snapshot. The resolver selects the `react-dom/server` `workerd` export, emits package modules under `node_modules`-style keys, and rewrites bare CJS `require("react")` / `require("react-dom")` specifiers to explicit Worker Loader module paths.
  - A 50-module local relative graph compiles and loads through Worker Loader in the stress test.
  - failed builds cannot be converted into Worker Loader definitions.
  - Vite / rolldown-vite / Oxlint / Oxfmt are explicitly classified as non-runtime-builder paths for this objective.

## Full AST paths in workerd

Follow-up control tests on 2026-07-01 now show three workerd-native TSX AST paths, with different operational tradeoffs:

- `@babel/parser@8.0.0` runs inside workerd as a pure JavaScript parser and returns a full Babel AST for TSX.
- The internal `experimentalParseReactTsxAst()` helper in `src/experiments/babel-ast.ts` wraps Babel parser for structural TSX experiments without widening the package's public Dynamic Worker API.
- The raw Oxc parser loaded through `@alexbruf/wasmkernel` returns a one-shot serialized `program` JSON string; `experimentalParseReactTsxAstWithOxc()` in `src/oxc/ast.ts` materializes that payload into a full Oxc/ESTree-style `Program` AST and applies Oxc's literal fixes.
- `@swc/wasm-web@1.15.43` runs inside workerd when its `wasm_bg.wasm` is imported as a precompiled `WebAssembly.Module` and passed explicitly to `initSync({ module })`; it returns an SWC AST and can transform TSX from both source text and a parsed AST.
- The internal `experimentalParseTransformReactTsxWithSwc()` helper in `src/experiments/swc.ts` captures the SWC path as archived parse+transform spike evidence without replacing the Oxc Dynamic Worker compiler path.

Evidence:

- `tests/workers/experiments/babel-parser-ast.test.ts`
  - Parses TSX with `plugins: ["typescript", "jsx"]`.
  - Asserts `ast.type === "File"`, `ast.program.type === "Program"`, and representative TypeScript/JSX nodes such as `TSTypeAnnotation`, `TSTypeParameterDeclaration`, `TSSatisfiesExpression`, `JSXElement`, and `JSXAttribute`.
  - Includes negative controls proving the `typescript` plugin alone is insufficient for JSX and the `jsx` plugin alone is insufficient for TypeScript syntax.
- `tests/workers/experiments/babel-ast-adapter.test.ts`
  - Calls the helper inside workerd and asserts a Babel `File`/`Program` AST with source locations, Babel source ranges, comments, and tokens.
  - Asserts parse failures return a structured `babel-parser` / `parse-failed` diagnostic with filename and location instead of throwing.
- `tests/workers/oxc/oxc-ast-access.test.ts`
  - Calls the raw wasmkernel Oxc parser binding and asserts the first `result.program` read is a non-empty JSON string whose `node.type === "Program"`.
  - Asserts a second `result.program` read returns `""`, documenting Oxc's one-shot getter semantics from the raw binding.
  - Runs an option matrix showing `astType`, `range`, `preserveParens`, and semantic-error options change AST shape/options but not emission of the serialized `Program` payload.
- `tests/workers/oxc/oxc-ast-materializer.test.ts`
  - Calls the internal materializer inside workerd and asserts a full `Program` AST with TypeScript and JSX node types.
  - Asserts BigInt and RegExp literal values are repaired using Oxc's `fixes` payload.
  - Asserts invalid TSX returns structured `oxc-parser` / `parse-failed` diagnostics.
- `tests/workers/experiments/swc-wasm-web.test.ts`
  - Imports `@swc/wasm-web/wasm_bg.wasm` and verifies it is a `WebAssembly.Module` in workerd.
  - Calls `initSync({ module: swcWasmModule })`, avoiding runtime wasm URL fetch/compile.
  - Parses TSX with `{ syntax: "typescript", tsx: true, target: "es2022" }` and asserts SWC AST node types including `Module`, `ExportDeclaration`, `VariableDeclaration`, and `JSXElement`.
  - Transforms TSX source and parsed AST with automatic React runtime output, asserting emitted `react/jsx-runtime` / `_jsx` code and TypeScript annotation removal.
- `tests/workers/experiments/swc-spike.test.ts`
  - Calls the internal helper inside workerd and asserts SWC `Module` AST output plus automatic-runtime ESM JavaScript.
  - Asserts the helper can transform from the parsed AST when requested.
  - Asserts invalid TSX returns structured `swc-wasm-web` / `parse-failed` diagnostics and parse evidence instead of throwing.
  - Exercises repeated parse+transform calls in one isolate as an early recovery/cache signal.

Interpretation:

- For immediate “full TSX AST inside workerd” requirement, `@babel/parser` is still the lowest-friction path: pure JS, no Wasm bootstrap, no Worker/thread dependency, a mature Babel AST, and the smallest Wrangler bundle shape measured in this spike.
- Oxc AST access is now viable in workerd too. Its value is AST + Oxc transform consistency, but it requires the custom wasmkernel path and careful one-shot raw getter handling.
- `@swc/wasm-web` is functionally strong, but its Wrangler dry-run bundle shape is large enough that this spike treats SWC as archived evidence rather than a near-term default.
- TypeScript compiler API remains a likely TS-native AST option, but it is much heavier and has `nodejs_compat_v2` hazards; it should be evaluated after Babel/SWC unless the application specifically needs TypeScript compiler AST nodes.
- Acorn + `acorn-typescript` remains a plausible small pure-JS ESTree-ish fallback, but Babel parser is a better first fit for correctness and TSX coverage.

### SWC operational comparison

`tests/workers/experiments/swc-operational.test.ts` adds an early operational comparison for the internal SWC helper. It runs in workerd/Vitest and records JSON metrics under the `[swc-operational-comparison]` log label.

The test exercises:

- first observed SWC source parse+transform in the test isolate;
- warm SWC source parse+transform;
- warm SWC transform from the parsed AST;
- a larger generated TSX module;
- invalid TSX parse diagnostics;
- successful valid-source recovery after a parse error;
- a same-source `compileDynamicWorker()` call through the current Oxc parser/transform path.

One local run on 2026-07-01 reported the following Vitest/workerd signal, included only as directional context:

```json
{
  "swcColdSourceMs": 39,
  "swcWarmSourceMs": 0,
  "swcWarmAstMs": 11,
  "swcLargeSourceMs": 5,
  "swcInvalidMs": 3,
  "swcRecoveryMs": 0,
  "oxcSmallCompileMs": 254,
  "largeSourceLength": 8530
}
```

Interpretation caveats:

- These are local workerd/Vitest timings, not production benchmarks.
- The first observed SWC call in a test isolate includes `@swc/wasm-web` initialization from an imported `WebAssembly.Module`, but the wasm module import/load cost is not isolated as a deployment cold-start measurement.
- The Oxc number includes the current `compileDynamicWorker()` path: Oxc parser wasmkernel initialization, Oxc transform wasmkernel initialization, graph discovery, and transform.
- SWC remains internal and is not wired into `compileDynamicWorker()`.

### Toolchain size and memory-risk surface

`tests/node/toolchain-footprint.test.ts` records raw and gzip sizes for the concrete package artifacts this spike imports. These numbers are useful as bundle-risk proxies, but they are **not** final Worker bundle sizes because Wrangler/Vite bundling, compression, module rules, and dependency tree-shaking can change deployment shape.

One local run on 2026-07-01 reported:

```json
{
  "babelParserRawBytes": 490465,
  "babelParserGzipBytes": 96565,
  "swcWasmRawBytes": 19285394,
  "swcWasmGzipBytes": 5042284,
  "oxcWasmkernelRawBytes": 5437939,
  "oxcWasmkernelGzipBytes": 1730492
}
```

Artifact-level interpretation:

- Babel parser's core JS file is much smaller than the Wasm toolchains in raw/gzip artifact terms. This supports Babel as the lowest-friction AST path for structural TSX structural analysis.
- `@swc/wasm-web/wasm_bg.wasm` is roughly 19.3 MB raw / 5.0 MB gzip in this install. That is the main SWC operational risk despite promising transform timings.
- The current Oxc path uses three Wasm-related artifacts in this spike: `oxc-parser.wasm.bin`, `oxc-transform.wasm.bin`, and `wasmkernel.wasm`, totaling roughly 5.4 MB raw / 1.7 MB gzip. That excludes JavaScript glue and any deployment bundler overhead.

`tests/node/wrangler-bundle-shape.test.ts` goes one step closer to deployable shape by running `wrangler deploy --dry-run --outdir --metafile` for tiny fixture Workers that import each path. It also runs `wrangler check startup` as an alpha-command startup signal. One local Wrangler 4.105.0 dry-run reported:

```json
{
  "babel": {
    "wranglerUploadBytes": 502139,
    "wranglerUploadGzipBytes": 99092,
    "metafileInputBytes": 494302,
    "metafileOutputBytes": 1605072,
    "startupOk": false
  },
  "swc": {
    "wranglerUploadBytes": 19313664,
    "wranglerUploadGzipBytes": 5049201,
    "metafileInputBytes": 33429,
    "metafileOutputBytes": 81806,
    "startupOk": false
  },
  "oxc": {
    "wranglerUploadBytes": 5615370,
    "wranglerUploadGzipBytes": 1766298,
    "metafileInputBytes": 278471,
    "metafileOutputBytes": 547805,
    "startupOk": false
  },
  "oxc-ast": {
    "wranglerUploadBytes": 2254561,
    "wranglerUploadGzipBytes": 678461,
    "metafileInputBytes": 228606,
    "metafileOutputBytes": 514358,
    "startupOk": false
  },
  "oxc-transform": {
    "wranglerUploadBytes": 5655153,
    "wranglerUploadGzipBytes": 1772913,
    "metafileInputBytes": 278462,
    "metafileOutputBytes": 625444,
    "startupOk": false
  }
}
```

Wrangler bundle-shape interpretation:

- Babel-only upload shape tracks the parser JS artifact closely: roughly 0.50 MB upload / 0.10 MB gzip for the tiny fixture.
- SWC upload shape is dominated by `@swc/wasm-web/wasm_bg.wasm`: roughly 19.3 MB upload / 5.0 MB gzip. The esbuild metafile output byte count is small because the Wasm module is not represented as ordinary bundled JS output.
- Oxc/wasmkernel upload shape is roughly 5.6 MB upload / 1.8 MB gzip for a tiny `checkReactTsx()` fixture. That includes the vendored Oxc guest bytes and wasmkernel path, plus JavaScript glue.
- The narrower Oxc AST fixture uploads at roughly 2.25 MB / 0.68 MB gzip because it imports the parser/materializer path without the transform wrapper.
- The Oxc transform fixture uploads at roughly 5.66 MB / 1.77 MB gzip, close to the broader Oxc fixture because it needs the transform guest bytes and wasmkernel path.
- Wrangler dry-run `outdir` contained metadata/README files in this run; the useful deployable-size signal came from Wrangler's `Total Upload` line and the esbuild metafile.
- `wrangler check startup` is currently an alpha command and returned `startupOk: false` for these generated fixture configs after building the Worker, with `Unexpected external import of "node:async_hooks"` from `hybrid-nodejs_compat`. Treat this as a tooling/startup-check limitation to revisit, not as proof the dry-run-deployable fixtures cannot start.
- These dry-run and startup-check numbers are still not production cold-start, memory/RSS, or full application bundle measurements.

### Oxc startup and operational measurement signals

`npm run test:startup` records local measurement signals for tiny Oxc AST and Oxc transform fixture Workers plus repeated Oxc AST/compile operations inside workerd. These measurements are local Vitest/Wrangler signals, not production benchmarks.

One local run on 2026-07-01 reported these workerd/Vitest timings:

```json
{
  "oxcAst": {
    "count": 3,
    "firstMs": 100,
    "warmAvgMs": 0.5,
    "minMs": 0,
    "maxMs": 100,
    "rawProgramLength": 2676
  },
  "oxcCompile10Modules": {
    "count": 3,
    "firstMs": 262,
    "warmAvgMs": 34,
    "minMs": 34,
    "maxMs": 262,
    "emittedModuleCount": 11
  }
}
```

Operational interpretation:

- First observed Oxc AST materialization and `compileDynamicWorker()` calls include wasmkernel/Oxc guest initialization costs in the local test isolate.
- Warm Oxc AST materialization is effectively sub-millisecond in this small fixture; warm 10-module compile is tens of milliseconds locally.
- The parse-failure recovery test proves a malformed TSX parse does not poison later Oxc AST materialization in the same local isolate.
- Current decision: Oxc remains the primary path if startup/bundle-shape numbers stay acceptable for the intended deployment shape; use these tests as regression signals before adding incremental editing or broader resolver features.

`tests/workers/measurements/toolchain-memory-risk.test.ts` records what memory APIs are visible in local workerd/Vitest and exercises repeated larger-input operations through Babel, SWC, and Oxc. One local run reported:

```json
{
  "sourceLength": 22970,
  "durations": {
    "babelRepeatedLargeParseMs": 19,
    "swcRepeatedLargeParseTransformMs": 96,
    "oxcRepeatedLargeCheckMs": 252
  },
  "memoryApiAvailable": true,
  "processMemory": {
    "rss": 0,
    "heapTotal": 0,
    "heapUsed": 0,
    "external": 0,
    "arrayBuffers": 0
  }
}
```

Memory interpretation caveats:

- Local `process.memoryUsage()` is present under `nodejs_compat`, but in this workerd/Vitest run it reported zero-valued fields before and after all phases. Treat it as a non-useful RSS signal for this spike.
- `performance.memory` was not observed in the logged snapshots.
- The test proves repeated larger-input parsing/transformation does not immediately crash in local workerd; it does **not** prove memory safety under production isolates, larger real applications, or concurrent sessions.
- True memory/RSS assessment still needs a deployment/runtime measurement path outside these local APIs.

Recommended near-term split:

- Full AST / structural editing: prefer the internal Babel helper first for low footprint, or the internal Oxc materializer when AST/transform consistency matters.
- Fast transform / AST transform experiment: use the internal SWC helper for bounded comparisons, but treat the Wrangler dry-run size result as a significant SWC risk and require production startup/memory evidence before considering any compiler-path changes.
- Existing Dynamic Worker graph transform: keep Oxc parser/transform path until SWC operational measurements prove better.
- Bundling: continue to defer Rolldown/Rspack/Farm/Parcel until their workerd packaging constraints change.

## Oxc full AST access in workerd

Full TSX AST consumers need AST access inside workerd, so this spike now includes explicit AST control tests in addition to the builder's parser-metadata tests.

Current result: **Oxc full AST access is available in workerd through the raw wasmkernel parser path, but the raw `program` getter is one-shot and returns serialized JSON rather than a ready object.**

Corrected evidence:

- Node control test: `tests/node/oxc-ast-control.test.ts`
  - `oxc-parser@0.137.0` through the normal Node wrapper returns `result.program.type === "Program"` for TSX.
  - The same result includes normal module metadata such as one static import.
- workerd raw control test: `tests/workers/oxc/oxc-ast-access.test.ts`
  - `@oxc-parser/binding-wasm32-wasi@0.137.0` vendored as `src/wasm/oxc-parser.wasm.bin`, loaded through `@alexbruf/wasmkernel@0.2.1`, returns parser errors, module metadata, and a raw serialized AST payload.
  - The **first** `result.program` read is a non-empty JSON string whose parsed payload has `node.type === "Program"`.
  - The **second** `result.program` read returns `""`, documenting raw Oxc N-API getter one-shot semantics.
  - The tested option matrix confirms options such as `astType`, `range`, `preserveParens`, and `showSemanticErrors` do not disable AST emission; they influence AST shape/metadata.
- workerd materializer test: `tests/workers/oxc/oxc-ast-materializer.test.ts`
  - `experimentalParseReactTsxAstWithOxc()` reads the raw program JSON exactly once, parses Oxc's `{ node, fixes }` payload, applies BigInt/RegExp literal fixes, and returns a full `Program` AST.
  - Invalid TSX returns structured `oxc-parser` / `parse-failed` diagnostics.

Source findings incorporated:

- Oxc's normal JS wrapper in `oxc-parser/src-js/wrap.js` parses `result.program` with `JSON.parse()`, extracts `{ node, fixes }`, applies BigInt/RegExp fixes, and caches the materialized program object.
- Oxc's Rust N-API `ParseResult.program` getter uses `mem::take`, so direct raw binding access consumes the string on first read. Tests that call `typeof result.program`, `result.program.length`, or `isProgramAst(result.program)` separately can accidentally consume the payload before measuring it.
- `astType` controls JavaScript vs TypeScript field inclusion, and `range` controls range fields; neither is an AST emission switch.
- Oxc raw transfer is deliberately unavailable on WASM32, so the JSON transfer path is the viable workerd path.
- The earlier no-go conclusion was caused by a test bug: it read the one-shot raw getter multiple times and observed the expected empty second/third reads.

Guidance for full TSX AST consumers:

- If a consumer needs full TSX AST traversal inside workerd today, Oxc is viable via the internal materializer.
- Babel remains the lowest-footprint AST path; Oxc is attractive when AST shape consistency with the Oxc transform/compiler path matters.
- No upstream issue is needed for the basic `program === ""` symptom when it occurs after a first direct raw getter read; that is expected low-level binding behavior. If a wrapped `oxc-parser/src-js/wasm.js` result returns empty on first access in a browser/WASI setup, that would be a separate upstream-worthy issue.

## Worker Loader object modules

Track 1 is positive in local workerd/Vitest control tests:

- Worker Loader accepts module-map entries shaped as `{ json }`, `{ text }`, `{ data }`, and `{ wasm }`.
- JS modules can import those object modules using ordinary static imports such as `import config from "./config.json"`, `import text from "./message.txt"`, `import bytes from "./bytes.bin"`, and `import wasm from "./add.wasm"`.
- The imported runtime values match existing Workers module semantics: JSON default import is the JSON value, text default import is a string, data default import is an `ArrayBuffer`, and wasm default import is a `WebAssembly.Module` suitable for `WebAssembly.instantiate(module, imports)`.
- The tested control keys used conventional extensions (`.json`, `.txt`, `.bin`, `.wasm`). This spike should keep preserving supplied object-module keys rather than inventing extensionless names.
- The builder now accepts exact virtual module leaves with `{ json }`, `{ text }`, `{ data }`, or `{ wasm }`, rewrites imports to absolute module keys such as `/app/config.json`, and emits unsupported virtual module shapes as `worker-loader` / `loader-shape-failed` diagnostics.

This does not imply general asset handling. There is still no CSS pipeline, URL import handling, npm fetching, full Node package resolution, or recursive graph scanning for non-JS object modules.

## React 19 package shape and Worker Loader control

Track 2 is partially positive and sharper than the initial package-shape hypothesis.

Published `react@19.2.7` and `react-dom@19.2.7` are CommonJS-only packages. There are no ESM package files to preserve directly as native Worker Loader ES modules. The relevant package exports are:

- `react` and `react/jsx-runtime`: default condition points to CJS gate files (`index.js`, `jsx-runtime.js`), with no `workerd` condition.
- `react-dom/server`: has a `workerd` condition that points to `server.edge.js`, but that file is also a CJS `process.env.NODE_ENV` gate shim.

The production server-render closure is small and Worker-compatible:

- `react/cjs/react.production.js`
- `react/cjs/react-jsx-runtime.production.js`
- `react-dom/cjs/react-dom.production.js`
- `react-dom/cjs/react-dom-server.edge.production.js`
- `react-dom/cjs/react-dom-server-legacy.browser.production.js`

The production bundles have no Node built-in `require()` calls, no unguarded `process.env` references, and rely on Web APIs available in workerd (`TextEncoder`, `ReadableStream`, `fetch`, `Headers`).

The local control test in `tests/workers/oxc/react-package-shape.test.ts` proves these actual package files can server-render in a Dynamic Worker module map, with these important constraints:

- The Dynamic Worker main module must still be ESM; Worker Loader rejects a CJS main module with `Main module must be an ES module`.
- React package files are emitted as Worker Loader `{ cjs }` modules.
- Module keys use `node_modules`-style paths such as `node_modules/react/index.js` and are imported from ESM with absolute specifiers such as `/node_modules/react/index.js`.
- Worker Loader does not perform full Node package resolution for arbitrary bare CJS `require()` calls in this dynamic module map. In the control test, unmodified `require("react")` from `node_modules/react-dom/cjs/react-dom-server.edge.production.js` resolved as `node_modules/react-dom/cjs/react`, not as `node_modules/react/index.js`.
- Therefore, a constrained package graph resolver would need to rewrite CJS `require("react")` and `require("react-dom")` to explicit Worker Loader module specifiers such as `require("/node_modules/react/index.js")` and `require("/node_modules/react-dom/index.js")`.

The constrained resolver experiment now implements those narrow pieces for exact in-memory snapshots: package exports resolution with condition selection (`workerd`, `worker`, `browser`, `import`, `require`, `default`), static ESM and literal CJS `require()` scanning/rewrite, package-root boundary validation, and diagnostics for unsupported package shapes. This is not a claim that general React npm support is implemented: there is no npm fetching, full Node resolution, CSS/assets pipeline, dynamic import/require support, or Rolldown bundling.

## Tool classifications

| Tool/package | Classification | Workerd runtime status | Worker Loader status | Notes |
| --- | --- | --- | --- | --- |
| `@rolldown/browser` | WASM/browser/workerd plausible, but not viable as published in this test | Not directly loadable | Not proven | Ships `rolldown-binding.wasm32-wasi.wasm` and browser exports, but browser glue fetches wasm via `new URL(..., import.meta.url)`, uses `new Worker(...)`, threaded/shared-memory assumptions, and emnapi/WASI runtime machinery. Workers support precompiled Wasm module imports, but this package does not expose an initializer that accepts one. |
| `rolldown` | Native/NAPI-bound Node library | Not viable | Not viable | Main package imports Node worker-thread machinery and resolves native/WASI bindings. Useful as a build-time library, not an in-Worker compiler. |
| `oxc-parser` | WASI/browser entry exists; viable only through a custom wasmkernel wrapper in this test | Narrow custom path works | Parser only | The package's published `browser: src-js/wasm.js` path is still not directly workerd-loadable because it fetches `parser.wasm32-wasi.wasm` and sets up browser worker-thread NAPI/WASI glue. This spike bypasses that glue, vendors `@oxc-parser/binding-wasm32-wasi@0.137.0`'s `parser.wasm32-wasi.wasm` as `src/wasm/oxc-parser.wasm.bin`, and runs it through `@alexbruf/wasmkernel`. |
| `oxc-transform` | WASI/browser entry exists; viable only through a custom wasmkernel wrapper in this test | Narrow custom path works | Proven for local relative transform-only Worker module graphs plus caller-provided virtual bare/object modules and constrained package snapshots | The package's published `browser.js` path is still not directly workerd-loadable because it fetches `transform.wasm32-wasi.wasm` and sets up browser worker-thread NAPI/WASI glue. This spike bypasses that glue, vendors `@oxc-transform/binding-wasm32-wasi@0.137.0`'s `transform.wasm32-wasi.wasm` as `src/wasm/oxc-transform.wasm.bin`, and runs it through `@alexbruf/wasmkernel`. A small Oxc-backed graph layer handles local relative imports, exact virtual module keys (`string`, `{ js }`, `{ json }`, `{ text }`, `{ data }`, `{ wasm }`), and exact in-memory `packageFiles` snapshots, but it does not fetch npm packages or bundle arbitrary package graphs. |
| `vite` | Node build/dev-server orchestrator | Not a runtime compiler path | Not viable | Published export is `./dist/node/index.js`; Vite is used to run dev servers and orchestrate builds, not to compile arbitrary code inside a Worker isolate. |
| `rolldown-vite` | Node Vite distribution | Not a runtime compiler path | Not viable | Same shape as Vite: Node-facing `dist/node/index.js`, with Rolldown as the build engine. |
| `oxlint` | CLI/native-oriented linter | Not a runtime lint path | Not applicable | No useful workerd lint API for this builder objective. |
| `oxfmt` | Native/NAPI-oriented formatter | Not a runtime format path | Not applicable | Formatter is valuable in a dev toolchain, but not a workerd runtime Worker Loader compiler path as published. |

## Comparison against esbuild-wasm

This spike intentionally does not use esbuild as a candidate implementation. It remains useful as a baseline because `@cloudflare/worker-bundler` uses it today.

| Dimension | esbuild-wasm / worker-bundler baseline | Oxc/Rolldown/Vite-family result here |
| --- | --- | --- |
| Workers compatibility | Proven by `@cloudflare/worker-bundler` when packaged with a Workers-resolvable wasm module and `worker: false` | Workers Wasm support is proven by this spike, but not for Oxc/Rolldown as published. Their browser/WASI glue is not directly loadable in the tested workerd setup. |
| Worker Loader compatibility | Proven by official docs and local `worker-bundler` tests | Control Loader shape is proven, including JS imports of `{ json }`, `{ text }`, `{ data }`, `{ wasm }`, and React-package `{ cjs }` modules. Narrow Oxc-transform-generated local relative module graphs reach Loader successfully, exact virtual bare modules work when emitted as concrete JS/object module keys with absolute rewritten imports, and exact `packageFiles` snapshots can be resolver-emitted for the React 19 production SSR path. Full Node/npm package resolution is not implemented. |
| Startup cost | Known concern due large wasm; measurable in worker-bundler style setup | `@rolldown/browser` wasm is ~11 MB; Oxc parser ~1.6 MB; Oxc transform ~3.3 MB. The narrow wasmkernel Oxc path initializes during the Workers test, but this spike has not measured startup/RSS under load. |
| API maturity | Mature transform/build API; worker-bundler wraps it for virtual files | `@rolldown/browser` has a Rollup/Rolldown-style API but runtime packaging blocks workerd use. Oxc parser/transform APIs are clear; this spike reaches Oxc transform only by bypassing the published browser glue. |
| TSX support | Yes | Oxc transform TSX support is proven for narrow local relative Worker graphs through wasmkernel. Rolldown should support TSX in principle, but is not reached in workerd. |
| Bundling support | Yes via esbuild + virtual FS | Rolldown supports bundling in principle; `@rolldown/browser` could be the right package if its wasm/runtime loading model becomes workerd-compatible. |
| Diagnostics quality | Good enough; worker-bundler wraps warnings/errors | Real Oxc parser and transform success/failure are now reachable in workerd. Bundler/package diagnostics are still local graph/runtime-shape diagnostics. |
| Output module shape | `mainModule` + `modules` proven | Proven for multiple transformed Oxc modules with local relative imports, object-module leaves, a manual React CJS package-file control map, and resolver-produced exact `packageFiles` snapshots for the React 19 production SSR path. The package resolver emits constrained in-memory package graphs only; general npm fetching, full Node resolution, CSS/assets, dynamic imports/requires, broad React support, and Rolldown output are not implemented. |

## Cloudflare Workers + Wasm docs audit

Cloudflare Workers supports WebAssembly, but with a specific security/deployment model:

- Wrangler / the Cloudflare Vite plugin import `.wasm` and `.wasm?module` as `WebAssembly.Module`.
- `WebAssembly.instantiate(module, imports)` is supported and should be done at module scope when possible.
- `WebAssembly.compile`, `WebAssembly.compileStreaming`, `WebAssembly.instantiateStreaming`, and `WebAssembly.instantiate(bytes, imports)` are not supported.
- Threading is not possible in Workers. Each Worker runs on a single thread and the Web Worker API is not supported.
- WASI support is experimental and only some syscalls are implemented.

This spike now includes `tests/workers/wasm-support.test.ts`, which proves the supported path by importing `src/wasm/add.wasm` as a precompiled module and instantiating it. The same test proves `WebAssembly.compile(bytes)` is rejected.

This is the key distinction for Oxc/Rolldown: a workerd-compatible package should accept a precompiled `WebAssembly.Module` import or another Workers-compatible asset shape. The published browser glues instead fetch wasm at runtime and initialize threaded WASI/NAPI runtimes. The wasmkernel Oxc parser/transform wrappers prove this can be bypassed for smaller NAPI/WASI guests by importing `@alexbruf/wasmkernel/wasmkernel.wasm` as a module and importing Oxc guest binaries as Wrangler `Data` modules.

Sources read:

- Cloudflare docs: `workers/runtime-apis/webassembly/index.mdx`
- Cloudflare docs: `workers/runtime-apis/webassembly/javascript.mdx`
- Cloudflare docs: `workers/runtime-apis/web-standards.mdx`
- Cloudflare docs: `workers/wrangler/bundling.mdx`
- Cloudflare docs: `workers/vite-plugin/reference/non-javascript-modules.mdx`
- Workers SDK fixtures: `fixtures/wasm-app`, `fixtures/import-wasm-example`, Pages Wasm fixtures

## Second-pass docs / plugins / tests audit

After the initial spike, I audited upstream docs, tests, plugin APIs, and browser/WASI glue for the likely places a hidden workerd path might exist. This did **not** overturn the conclusion, but it sharpened it.

### Oxc parser / transform

No Oxc docs or tests were found for Cloudflare Workers, workerd, or edge-runtime initialization. The documented non-Node usage is browser / StackBlitz / WebContainer-style usage.

Important nuance: the underlying emnapi runtime appears to accept a precompiled `WebAssembly.Module` and has a single-thread-ish `asyncWorkPoolSize: 0` path. That means a custom workerd-specific wrapper might be possible in principle. The published Oxc browser entries do not expose such an initializer; they hard-code package-relative wasm fetch and Worker-thread style WASI/NAPI setup.

The parser and transform WASI guests can be initialized through wasmkernel, but the published Oxc browser glue remains unsuitable as-is. `oxc-transform` also does not provide bundler/module-format output. This spike now supplies a minimal Oxc-backed local relative graph layer around Oxc transform, plus exact caller-provided virtual bare modules and constrained exact `packageFiles` snapshots. General npm/package resolution, dependency bundling, and broad React runtime resolution remain bundler concerns; the implemented package path is limited to caller-supplied in-memory snapshots with a small condition list and static import/literal `require()` rewrites, including the proven React 19 production SSR closure.

### Rolldown browser / plugins

`@rolldown/browser` is still the most relevant package. Its Rollup-compatible plugin API can support virtual/in-memory files through the standard `resolveId` + `load` pattern, and upstream tests/docs confirm the virtual module pattern. The local spike's virtual file plugin is therefore the right shape.

The blocker is below plugins: wasm initialization happens at module evaluation time before plugins matter. The published browser glue has no `initialize(...)`, no way to pass a `WebAssembly.Module`, and no option to disable dynamic Worker creation. The wasm binary is a threads build, so shared memory/worker-thread assumptions are not incidental.

`@rolldown/browser/experimental` also exposes promising APIs such as transform, parse, minify, memfs, module-runner transforms, and `DevEngine`, but all are behind the same wasm bootstrap.

### Vite 8 / rolldown-vite

Vite 8 and rolldown-vite expose rich programmatic APIs, but the compiler/dev-server side is Node-facing. No workerd-native transform+bundle API was found.

One useful development-loop path did emerge: `vite/module-runner` is mostly an evaluator/runner and is plausibly workerd-compatible in isolation. It does **not** transform or bundle code by itself; it expects a Vite dev server to provide pre-transformed modules over a transport. This could support a hybrid dev loop where workerd evaluates modules served by a Node Vite server, but it is not an in-workerd replacement for `@cloudflare/worker-bundler`.

## Local stress measurements

These are not benchmark guarantees; they are local workerd/Vitest measurements from `tests/workers/oxc/compile-stress.test.ts` on 2026-06-30. They are useful for order-of-magnitude signal and regression detection, not hard performance limits.

Command:

```sh
npx vitest run --config vitest.workers.config.ts tests/workers/oxc/compile-stress.test.ts --reporter verbose
```

Observed output:

```json
{
  "checkColdMs": 99,
  "checkWarmMs": 0,
  "graph10ColdMs": 173,
  "graph10WarmMs": 12,
  "graph50Ms": 92,
  "graph10Modules": 11,
  "graph50Modules": 51,
  "graph50Evidence": [
    {
      "tool": "rolldown-browser",
      "stage": "import",
      "ok": false,
      "durationMs": 0,
      "detail": "published browser entry fetches .wasm via file URL in this test runtime"
    },
    {
      "tool": "oxc-parser",
      "stage": "import",
      "ok": true,
      "durationMs": 0,
      "detail": "instantiated oxc-parser wasm through @alexbruf/wasmkernel"
    },
    {
      "tool": "oxc-transform",
      "stage": "import",
      "ok": true,
      "durationMs": 0,
      "detail": "instantiated oxc-transform wasm through @alexbruf/wasmkernel"
    },
    {
      "tool": "oxc-transform",
      "stage": "bundle",
      "ok": true,
      "durationMs": 66,
      "detail": "51 local modules resolved from Oxc parser metadata"
    },
    {
      "tool": "oxc-transform",
      "stage": "transform",
      "ok": true,
      "durationMs": 26,
      "detail": "51 modules transformed"
    }
  ]
}
```

Interpretation:

- Parser/transform guest initialization is visible on first use but cached for the isolate lifetime.
- Warm 10-module graph compilation completed in low double-digit milliseconds in this local run.
- A 51-module Worker Loader graph compiled and loaded successfully.
- The stress test does not measure Worker memory/RSS; that remains a production-readiness gap.

## What would make this viable

The most promising future path is not Vite itself; it is a lower-level runtime package shaped like `@rolldown/browser` or Oxc's WASI bindings, but packaged for workerd:

1. Avoid dynamic `new Worker(...)` for wasm initialization, or provide a `worker: false` equivalent.
2. Avoid runtime wasm fetch/compile; Workers does not allow runtime `WebAssembly.compile(bytes)` or `instantiate(bytes, ...)`.
3. Allow the host Worker bundle to import the `.wasm` as a precompiled `WebAssembly.Module`, the documented Workers path.
4. Avoid `window`/`document` assumptions in browser glue.
5. Avoid WASI-thread requirements; Workers runs each Worker on a single thread and does not support the Web Worker API.
6. Provide a virtual filesystem/module loader API suitable for in-memory user code, not disk-first Node workflows.
7. Emit a small number of JS module strings directly suitable for Worker Loader.

## Practical conclusion

For the core objective — loading and modifying arbitrary workerd-targeted React code into Dynamic Workers with a good development loop — the VoidZero-family pieces are promising but not currently packaged in the right shape for complete workerd runtime compilation.

The custom Oxc parser/transform + wasmkernel path is the first concrete positive result. It proves workerd can host Oxc NAPI/WASI guests and use transform across a local relative module graph when the host supplies assets in Workers-compatible forms:

- `@alexbruf/wasmkernel/wasmkernel.wasm` as a precompiled `WebAssembly.Module`.
- `@oxc-parser/binding-wasm32-wasi@0.137.0`'s `parser.wasm32-wasi.wasm` vendored as `src/wasm/oxc-parser.wasm.bin` and `@oxc-transform/binding-wasm32-wasi@0.137.0`'s `transform.wasm32-wasi.wasm` vendored as `src/wasm/oxc-transform.wasm.bin`, both loaded via a Wrangler `Data` rule so wasmkernel receives raw bytes.
- Lazy request-time initialization, because WASI initialization may need APIs such as `crypto.getRandomValues()` that should not run at module initialization.
- `unshareMemory: true`, avoiding the published browser glue's shared-memory/thread setup.

The remaining gaps are still substantial:

- Oxc transform is not a full bundler. The local graph layer resolves `import { Widget } from "./Widget"`-style relative source files, exact caller-provided virtual module keys, and constrained exact `packageFiles` snapshots, but it will not fetch npm packages or resolve/bundle arbitrary external React/npm imports. JS virtual modules accept `string` shorthand or `{ js }`, are emitted as concrete `.js` Worker Loader module keys, can import each other, and imports are rewritten to absolute paths. Non-JS virtual modules accept `{ json }`, `{ text }`, `{ data }`, or `{ wasm }`, preserve their supplied module keys, and are emitted as leaf Worker Loader object modules. Actual React package files are proven both in a manual control map using `{ cjs }` plus explicit CJS `require()` rewrites and in a resolver-produced React 19 production SSR package snapshot.
- Oxc parser is wired through wasmkernel for `checkReactTsx()` and graph discovery, but the raw NAPI parser metadata is incomplete for some module forms in workerd. The graph layer therefore uses Oxc metadata for static imports/type-only handling plus parser-validated extraction for export-from and dynamic-import specifiers.
- `@rolldown/browser` remains blocked before its plugin layer by package bootstrap assumptions.
- `@alexbruf/wasmkernel` is very new and should remain a spike dependency/prior-art path until its stability, memory profile, and operational behavior are better understood.

The right next experiments would be deliberately narrow:

- Measure memory/RSS and CPU behavior outside this lightweight Vitest timing harness, especially under repeated concurrent use and larger user projects.
- Broaden package snapshot diagnostics only where exact in-memory `packageFiles` use cases require it, without adding npm fetching, full Node resolution, CSS/assets handling, dynamic import/require support, or broad React/npm bundling claims.
- Investigate whether Oxc parser's raw NAPI module metadata can expose static exports and dynamic imports reliably in workerd, removing the remaining parser-validated supplemental extraction.
- Try a custom `@rolldown/browser` bootstrap only if a single-threaded/non-worker wasm build is available or upstream exposes an initialization hook.
- Separately prototype a hybrid Vite module-runner dev loop where Node Vite transforms modules and workerd evaluates them, recognizing that this is not an in-workerd compiler.

Do not build upstream locally without a specific reason; these projects may be large. The published packages and docs already expose enough shape to identify the current blocker.
