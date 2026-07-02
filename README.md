# workerd-oxc

Run the [Oxc](https://oxc.rs) parser and transformer inside Cloudflare Workers.

Workers can't compile WebAssembly at runtime — no `WebAssembly.compile`, no
fetching `.wasm` over the network, no threads. That rules out the stock Oxc
WASI/browser builds. `workerd-oxc` ships Oxc as static, zero-import
`WebAssembly.Module` artifacts with a tiny hand-written ABI, so parsing and
transforming TS/TSX works in a Worker with nothing else wired up.

```ts
import { transform } from "workerd-oxc";

const result = await transform({
  filename: "component.tsx",
  source: "export const view = <main>Hello</main>;",
  jsx: { runtime: "automatic", importSource: "react" },
});

if (result.ok) {
  result.value.code; // '...jsx("main", { children: "Hello" })...'
}
```

## Install

```sh
npm install workerd-oxc
```

The npm package includes prebuilt `.wasm` artifacts, so consumers do not need a Rust toolchain. Source checkouts build those artifacts from Rust; see [Building](#building-from-source).

## Usage

There are two ways in. Both do the same work.

**One-shot functions** lazily initialize a shared instance on first call:

```ts
import { parse, transform } from "workerd-oxc";

const parsed = await parse({ filename: "app.tsx", source });
const transformed = await transform({ filename: "app.tsx", source });
```

**An explicit instance** pays initialization once, then runs synchronously.
Prefer this in a hot path:

```ts
import { createOxc } from "workerd-oxc";

const oxc = await createOxc();

oxc.parse({ filename: "app.tsx", source });
oxc.transform({ filename: "app.tsx", source });
```

Instance methods are synchronous because, once the module is instantiated, a
parse or transform is a plain CPU-bound Wasm call.

## API

### `createOxc(): Promise<Oxc>`

Instantiates the parser and transformer and returns an instance with
synchronous `parse` and `transform` methods.

### `parse(input): Promise<OxcResult<ParseOutput>>` / `oxc.parse(input)`

Parses a source file into a full Oxc [ESTree](https://oxc.rs)-shaped AST.

```ts
interface ParseInput {
  filename: string;
  source: string;
  lang?: "js" | "jsx" | "ts" | "tsx"; // default: inferred from filename
  sourceType?: "module" | "script"; // default: "module"
  astType?: "js" | "ts"; // default: "ts" for .ts/.tsx/.mts/.cts
  range?: boolean; // include byte ranges (default: false)
  preserveParens?: boolean; // default: false
}

interface ParseOutput {
  ast: OxcProgramAst; // { type: "Program", body: [...], ... }
  rawProgramLength: number;
}
```

`BigInt` and `RegExp` literals are materialized to real JS values, matching
Oxc's own JS wrapper.

### `transform(input): Promise<OxcResult<TransformOutput>>` / `oxc.transform(input)`

Strips TypeScript types and lowers JSX for a single file. It does not resolve
imports or bundle — see [Scope](#scope).

```ts
interface TransformInput {
  filename: string;
  source: string;
  lang?: "js" | "jsx" | "ts" | "tsx"; // default: inferred from filename
  sourceType?: "module" | "script"; // default: "module"
  target?: string; // e.g. "es2022" (default: "es2022")
  sourcemap?: boolean; // default: false
  jsx?:
    | "preserve"
    | {
        runtime?: "automatic" | "classic"; // default: "automatic"
        importSource?: string; // default: "react"
        development?: boolean; // default: false
      };
}

interface TransformOutput {
  code: string;
  map?: SourceMapV3; // present only when sourcemap: true
}
```

### Results

Everything returns a discriminated result. Expected failures — syntax errors,
invalid transforms — are diagnostics, not thrown exceptions.

```ts
type OxcResult<T> =
  | { ok: true; value: T; diagnostics: OxcDiagnostic[] }
  | { ok: false; diagnostics: OxcDiagnostic[] };
```

A successful result can still carry warnings, so gate on `ok`, not on
`diagnostics.length`.

### Diagnostics

```ts
interface OxcDiagnostic {
  phase: "parse" | "transform" | "runtime";
  severity: "error" | "warning";
  message: string;
  filename?: string;
  location?: { line: number; column: number }; // both 1-based
  span?: { start: number; end: number };
  cause?: string;
}
```

`span` offsets are JavaScript string offsets (UTF-16 code units), converted
from Oxc's native UTF-8 byte offsets. They index into the `source` string you
passed in.

## How it works

```
your Worker
  └─ workerd-oxc
       ├─ dist/wasm/parser.wasm      (wasm32-unknown-unknown, 0 imports)
       ├─ dist/wasm/transform.wasm   (wasm32-unknown-unknown, 0 imports)
       └─ a small pointer/length/result ABI in JavaScript
```

The `.wasm` files are Rust crates ([`native/`](native)) that wrap the Oxc
parser and transformer and expose a handful of C-ABI functions
(`alloc`, `parse`/`transform`, `result_ptr`, `free_result`, …). The TypeScript
host writes UTF-8 into Wasm memory, calls in, and reads a JSON result back out.

There is no N-API, no emnapi, no WASI, no runtime `WebAssembly.compile`, no
browser `Worker`, and no shared memory. The modules import nothing —
`WebAssembly.Module.imports(module)` is `[]` — which is what makes them loadable
in workerd.

## Scope

This is a parser and a transformer, nothing more.

It is **not** a bundler, package manager, npm resolver, or a drop-in for Vite,
esbuild, or Rolldown. It transforms one file at a time and leaves import
specifiers untouched. Out of scope, by design:

- module resolution and bundling
- npm / `package.json` `exports` resolution
- CJS/ESM interop shims
- CSS, assets, and `import.meta.url` handling
- dynamic `import()` / `require()` rewriting

If you need any of that, reach for a real bundler.

## Cloudflare Worker Loader

Because `transform` emits plain module source, its output can be loaded as a
[Dynamic Worker](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/).
See [`examples/worker-loader`](examples/worker-loader) for an end-to-end proof.
Loader wiring is left to you — it is not part of this package's API.

## Building from source

Requires Rust 1.95.0 with the `wasm32-unknown-unknown` target. The repo includes `rust-toolchain.toml`, so `rustup` will install the right toolchain/target automatically:

```sh
npm run build:wasm
```

`npm run build:wasm` generates `src/wasm/parser.wasm` and `src/wasm/transform.wasm`. `npm run build` runs that step and then copies the artifacts into `dist/wasm/` for packaging.

## Wasm artifacts

The parser and transformer `.wasm` files are generated from the Rust crates and shipped in the npm package because Workers load them as static `WebAssembly.Module` imports. Runtime consumers should not need Rust or a Wasm build step.

For artifact details:

```sh
npm run wasm:info
npm run wasm:check
```

`wasm:check` verifies the two properties this package depends on: zero imports and the expected ABI exports.

## Development

The canonical check is:

```sh
npm run check
```

That runs Oxlint, Oxfmt, Rust formatting checks, Wasm artifact checks, package-shape checks, TypeScript, node tests, and workerd tests.

Useful commands:

```sh
npm run lint        # Oxlint
npm run fmt:check   # Oxfmt + rustfmt check
npm run fmt         # Oxfmt + rustfmt write
npm run wasm:info   # artifact size/hash/import/export summary
npm run wasm:check  # artifact ABI/import guard
npm test            # typecheck + node + workerd tests
npm run test:node
npm run test:workers
```

If you use [`just`](https://github.com/casey/just), the repo also has a thin command facade:

```sh
just check
just fmt
just build-wasm
```

Worker tests run under
[`@cloudflare/vitest-pool-workers`](https://github.com/cloudflare/workers-sdk).

## License

[MIT](LICENSE)
