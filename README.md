# workerd-oxc

`workerd-oxc` is a small experimental adapter for running Oxc parser and transform inside Cloudflare `workerd`.

It provides:

- full TS/TSX AST materialization from Oxc inside workerd;
- an experimental direct Oxc parser ABI that avoids N-API/wasmkernel for parsing;
- one-file TS/TSX/JSX transformation through Oxc inside workerd;
- explicit module-map compilation for Dynamic Workers / Worker Loader;
- Worker Loader definition/loading helpers;
- deterministic Dynamic Worker build IDs;
- structured diagnostics and source-location helpers.

It is **not** a bundler, package manager, npm resolver, Vite replacement, Rolldown replacement, esbuild replacement, or general React app compiler.

## Why this exists

Cloudflare Workers can import `.wasm` files as precompiled `WebAssembly.Module` objects, but workerd does not allow runtime Wasm compilation from arbitrary bytes and does not expose browser `Worker` threads. Published Oxc/Rolldown browser/WASI glue is therefore not directly usable in workerd as-is.

This package keeps the useful, bounded part of the earlier spike: expose a safe Oxc AST adapter, expose a one-file transform adapter, and bridge explicit output module maps to Dynamic Workers.

The current transform path and stable parser path still instantiate Oxc's WASI/N-API binaries through `@alexbruf/wasmkernel`. The experimental direct parser path is the first step toward a cleaner long-term architecture: a repo-local Oxc Wasm wrapper with a small pointer/length ABI, imported by workerd as a static `WebAssembly.Module`, with no N-API/emnapi host and no runtime Wasm fetch/compile.

The broad JavaScript ecosystem layer is intentionally left to real bundlers. If you need npm fetching, package resolution, CJS/ESM compatibility, CSS/assets, or arbitrary React app builds today, use a bundler-oriented path such as `@cloudflare/worker-bundler`/esbuild or wait for a workerd-compatible Rolldown backend.

## Install

```sh
npm install workerd-oxc
```

This package is experimental and currently private in this repo.

## API

### `parseReactTsxAst(filename, source, options?)`

Parses TS/TSX/JS/JSX with Oxc inside workerd and returns a materialized Oxc `Program` AST.

```ts
import { parseReactTsxAst } from "workerd-oxc";

const result = await parseReactTsxAst("src/component.tsx", `
  type Props = { label: string };
  export function Component(props: Props) {
    return <span>{props.label}</span>;
  }
`);

if (result.ok) {
  console.log(result.ast.type); // "Program"
}
```

The raw Oxc N-API parser exposes `result.program` as a one-shot JSON string. `parseReactTsxAst()` reads it exactly once, parses the `{ node, fixes }` payload, and applies Oxc wrapper-style BigInt/RegExp literal fixes before returning the AST.

### `experimentalParseReactTsxAstDirect(filename, source, options?)`

Parses TS/TSX/JS/JSX with the repo-local direct parser Wasm artifact instead of the `wasmkernel` N-API bridge.

```ts
import { experimentalParseReactTsxAstDirect } from "workerd-oxc";

const result = await experimentalParseReactTsxAstDirect("src/component.tsx", `
  export const view = <main>Hello</main>;
`);
```

This is intentionally experimental and parser-only. It exists to prove the long-term architecture: `src/wasm/oxc-direct-parser.wasm` is imported as a static `WebAssembly.Module`, exposes a tiny direct ABI, and currently has **zero Wasm imports**. Transform still uses the `wasmkernel` bridge.

Build the direct parser artifact with:

```sh
npm run build:direct-parser
```

### `transformReactTsx(filename, source, options?)`

Transforms one source file with Oxc inside workerd.

```ts
import { transformReactTsx } from "workerd-oxc";

const result = await transformReactTsx("src/component.tsx", `
  export const view = <span>Hello</span>;
`);

if (result.ok) {
  console.log(result.code);
}
```

This is a one-file transform. It does not resolve imports or bundle dependencies.

### `compileDynamicWorkerModules(input)`

Transforms an explicit caller-supplied module map into a complete Worker Loader module map.

```ts
import {
  compileDynamicWorkerModules,
  dynamicWorkerBuildId,
  loadDynamicWorker,
} from "workerd-oxc";

const build = await compileDynamicWorkerModules({
  entrypoint: "src/index.ts",
  modules: {
    "src/index.ts": `
      import { message } from "./message.js";
      export default { fetch() { return new Response(message) } };
    `,
    "src/message.ts": `export const message: string = "hello";`,
  },
});

if (build.ok) {
  const id = dynamicWorkerBuildId("demo", build);
  const worker = loadDynamicWorker(env.LOADER, id, build, {
    compatibilityDate: "2026-06-30",
  });
}
```

Important: this is an **explicit module-map compiler**, not a resolver. If `src/index.ts` imports `./message.js`, the caller must provide a module that emits `src/message.js`. TypeScript input files emit `.js` module keys; object modules keep their supplied keys.

### `toLoaderDefinition(build, options?)` / `loadDynamicWorker(loader, id, build, options?)`

Convert a successful build to the Worker Loader definition shape and call `env.LOADER.get(id, ...)`.

### `hashDynamicWorkerBuild(build)` / `dynamicWorkerBuildId(prefix, build)`

Hash a complete `mainModule + modules` map and derive a revision-style Worker Loader ID. Worker Loader caches by ID, so changed code should use a changed ID.

The hash is deterministic across module insertion order, canonicalizes JSON object key order, includes object module type tags and `ArrayBuffer` bytes, and rejects failed/incomplete builds.

## Supported module input shapes

`compileDynamicWorkerModules()` accepts:

```ts
type DynamicWorkerModuleContent =
  | string
  | { js: string }
  | { cjs: string }
  | { json: unknown }
  | { text: string }
  | { data: ArrayBuffer }
  | { wasm: ArrayBuffer };
```

String source modules are transformed with Oxc. Object modules are preserved as Worker Loader object modules.

## Unsupported by design

| Capability | Status |
| --- | --- |
| Oxc TS/TSX AST in workerd | Supported |
| Direct Oxc parser ABI | Experimental parser-only prototype |
| Oxc one-file transform in workerd | Supported through current bridge |
| Explicit Dynamic Worker module maps | Supported |
| Worker Loader build IDs | Supported |
| npm fetching | Not supported |
| package.json exports / Node resolution | Not supported |
| CJS require scanning/rewriting | Not supported |
| CSS/assets/import-url pipelines | Not supported |
| dynamic import/require support | Not supported |
| arbitrary React app compilation | Not supported |
| Rolldown backend | Deferred until upstream workerd-compatible initialization exists |

## Tests

```sh
npm run build:direct-parser
npm run typecheck
npm test
npm run test:node
npm run test:workers
```

The Workers tests run with `@cloudflare/vitest-pool-workers` and a Worker Loader binding named `LOADER`.

## Archive note

This clean package replaces a broader research spike. The previous exploratory state is preserved in git history and tagged as `spike-archive-2026-07-02`.
