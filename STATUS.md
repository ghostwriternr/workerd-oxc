# Status

`workerd-oxc` is a focused Cloudflare workerd-only Oxc adapter.

## Current scope

The package currently provides:

- static `parser.wasm` and `transform.wasm` artifacts built from repo-local Rust wrappers around Oxc crates;
- zero-import Wasm artifact shape for both parser and transform;
- a tiny TypeScript pointer/length/result ABI host;
- `createOxc()` for initialized parser/transform instances;
- async top-level `parse()` and `transform()` convenience functions;
- sync instance `oxc.parse()` and `oxc.transform()` methods;
- normalized source-aware diagnostics;
- optional Source Map v3 output from transform;
- an example-only Worker Loader proof.

## Runtime properties

The runtime path does not use N-API, emnapi, WASI, `@alexbruf/wasmkernel`, `@bjorn3/browser_wasi_shim`, runtime Wasm fetch/compile, browser `Worker`, or shared-memory host setup.

## Non-goals

This package does not provide:

- npm fetching;
- package resolution;
- CJS/ESM compatibility layers;
- CSS/assets/import-url handling;
- dynamic import/require support;
- bundling;
- Vite/esbuild/Rolldown replacement behavior;
- core Worker Loader helper APIs.

Worker Loader remains only as an example showing that transformed output can be loaded manually as a Dynamic Worker.

## Known limitations

- Transform is one-file-at-a-time and leaves imports as source-level imports.
- Public transform options are intentionally narrow.
- Source-map lookup helpers are not exposed yet.
- Performance, memory, artifact-size, release, and provenance hardening still need dedicated follow-up before publishing.
- Shared Rust ABI helper refactoring is deferred until the parser and transform ABI shapes settle further.
