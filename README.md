# workerd-oxc

`workerd-oxc` runs Oxc parser and transform inside Cloudflare workerd using static zero-import WebAssembly modules.

It is a small workerd-only adapter around repo-local Oxc Wasm artifacts:

```txt
Cloudflare workerd
  -> static parser.wasm      # wasm32-unknown-unknown, zero imports
  -> static transform.wasm   # wasm32-unknown-unknown, zero imports
  -> tiny TypeScript ABI host
  -> parse + transform API
```

## What it provides

- Oxc TS/TSX/JS/JSX parsing inside workerd.
- Full Oxc `Program` AST materialization.
- One-file Oxc transform inside workerd.
- Source-aware diagnostics with JavaScript UTF-16 string-offset spans.
- Optional Source Map v3 output from transform.
- A Worker Loader example proving transformed output can be loaded manually.

## What it avoids

The runtime path does **not** use:

- N-API or emnapi;
- WASI;
- `@alexbruf/wasmkernel`;
- `@bjorn3/browser_wasi_shim`;
- runtime Wasm `fetch()`;
- runtime Wasm compilation from bytes;
- browser `Worker` threads;
- shared-memory host setup.

This package is **not** a bundler, package manager, npm resolver, Vite replacement, Rolldown replacement, esbuild replacement, or arbitrary React app compiler. It does not implement package resolution, CJS/ESM compatibility layers, CSS/assets/import-url handling, dynamic import/require support, or module graph rewriting.

Worker Loader is example-only. The core package does not export Worker Loader helpers.

## API

```ts
import { createOxc, parse, transform } from "workerd-oxc";
```

### Top-level convenience functions

Top-level functions lazily initialize a default Oxc instance, so they are async.

```ts
const parsed = await parse({
  filename: "src/component.tsx",
  source: `
    type Props = { label: string };
    export function Component(props: Props) {
      return <span>{props.label}</span>;
    }
  `,
  lang: "tsx",
  range: true,
});

if (parsed.ok) {
  console.log(parsed.value.ast.type); // "Program"
}

const transformed = await transform({
  filename: "src/component.tsx",
  source: `export const view = <main>Hello</main>;`,
  jsx: { runtime: "automatic", importSource: "react" },
  sourcemap: true,
});

if (transformed.ok) {
  console.log(transformed.value.code);
  console.log(transformed.value.map);
}
```

### Initialized instance

`createOxc()` pays the Wasm instantiation cost once. Instance methods are synchronous because initialized parser/transform calls are CPU-bound Wasm calls.

```ts
const oxc = await createOxc();

const parsed = oxc.parse({
  filename: "src/component.tsx",
  source: `export const view = <main>Hello</main>;`,
});

const transformed = oxc.transform({
  filename: "src/component.tsx",
  source: `export const view = <main>Hello</main>;`,
  sourcemap: false,
});
```

## Types

```ts
type OxcLanguage = "js" | "jsx" | "ts" | "tsx";
type OxcSourceType = "module" | "script";

type OxcResult<T> =
  | { ok: true; value: T; diagnostics: OxcDiagnostic[] }
  | { ok: false; diagnostics: OxcDiagnostic[] };
```

Diagnostics use this coordinate contract:

- `location.line` is 1-based.
- `location.column` is 1-based.
- `span.start` and `span.end` are JavaScript UTF-16 string offsets.
- Native Oxc UTF-8 byte spans are converted before diagnostics are exposed.

## Build the Wasm artifacts

```sh
npm run build:wasm
```

This builds:

- `src/wasm/parser.wasm`
- `src/wasm/transform.wasm`

Both artifacts are expected to have `WebAssembly.Module.imports(module) === []`.

## Tests

```sh
npm run build:wasm
npm run typecheck
npm test
npm run test:node
npm run test:workers
```

The Workers tests run with `@cloudflare/vitest-pool-workers`. The Worker Loader proof test uses a binding named `LOADER` but constructs the loader definition manually.

## Worker Loader example

See `examples/worker-loader/` for a manual Dynamic Worker / Worker Loader proof. It uses `createOxc()` and then calls `env.LOADER.get()` directly. No Worker Loader helper is exported by this package.

## Archive note

Earlier history in this repository explored a broader Dynamic Worker builder spike, bridge-based Oxc execution, package snapshots, CJS scanning, React package controls, SWC/Babel/Rolldown comparisons, measurements, and session caches.

That work is intentionally outside the current package boundary. The previous exploratory state is preserved in git history and tagged as `spike-archive-2026-07-02`.
