# Status

`workerd-oxc` is an experimental, focused package extracted from a broader Dynamic Worker builder spike.

## Current scope

The package is intended to be complete at a narrow layer:

- initialize Oxc parser/transform inside Cloudflare workerd;
- materialize full TS/TSX Oxc ASTs safely;
- prove a parser-first direct Oxc Wasm ABI that avoids N-API/wasmkernel for parsing;
- transform one TS/TSX/JSX module at a time;
- compile explicit caller-supplied module maps into Worker Loader definitions;
- provide Dynamic Worker build IDs and Worker Loader helper functions.

## Durable findings retained

- Oxc parser and transform can run inside workerd through `@alexbruf/wasmkernel` and vendored Oxc WASI bytes.
- A repo-local parser-only direct ABI artifact can run inside workerd as a static `WebAssembly.Module` with zero Wasm imports.
- Oxc parser AST access works when the raw one-shot `program` JSON string is read exactly once and materialized with Oxc wrapper-style fixes.
- Worker Loader can load explicit `mainModule + modules` definitions produced from transformed code and object modules.
- Dynamic Worker IDs should be content/revision based because Worker Loader caches by ID.

## Intentionally removed from the clean package

The previous spike explored package snapshots, CJS require scanning, React package controls, SWC/Babel/Rolldown comparisons, measurements, and session caches. Those remain available in git history under tag `spike-archive-2026-07-02`, but they are not part of this package.

The removed layer is replaceable: broad graph/package/bundler semantics should come from a real bundler backend such as esbuild today or a future workerd-compatible Rolldown, not from this package growing a custom JavaScript bundler.

## Non-goals

- npm fetching
- full package resolution
- CJS/ESM compatibility layers
- CSS/assets/import-url handling
- dynamic import/require support
- app-framework compilation
- Vite/esbuild/Rolldown replacement

## Completion bar

This package should stay small. Future work should improve the focused Oxc adapter and Worker Loader bridge, not expand into a general bundler.

The direct parser ABI is experimental and parser-only. It should become the long-term parser backend only after parity, memory, artifact-size, and release/provenance checks are strong enough. Transform remains on the current `wasmkernel` bridge until a separate direct transform ABI prototype proves equivalent behavior.
