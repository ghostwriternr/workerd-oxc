# workerd-oxc

Run the [Oxc](https://oxc.rs) parser and transformer inside Cloudflare Workers.
An experimental per-file semantic analyzer is also included.

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

The npm package ships prebuilt `.wasm` artifacts, so consumers do not need a
Rust toolchain. Building from a source checkout does; see
[Building from source](#building-from-source).

## Getting started

There are two ways in; both do the same work.

Call the one-shot functions when you parse or transform occasionally. They
lazily initialize a shared instance on first call and return a promise:

```ts
import { parse, transform } from "workerd-oxc";

const parsed = await parse({ filename: "app.tsx", source });
const transformed = await transform({ filename: "app.tsx", source });
```

Create an explicit instance when you work in a hot path. It pays
initialization once, then runs synchronously:

```ts
import { createOxc } from "workerd-oxc";

const oxc = await createOxc();

oxc.parse({ filename: "app.tsx", source });
oxc.transform({ filename: "app.tsx", source });
```

Every call returns a result object rather than throwing on expected failures.
Gate on `result.ok`:

```ts
const result = await transform({ filename: "app.tsx", source });

if (result.ok) {
  deploy(result.value.code);
} else {
  report(result.diagnostics);
}
```

## API

### `createOxc(): Promise<Oxc>`

Instantiates the Wasm modules and returns an instance with synchronous
`parse`, `transform`, and `experimentalAnalyze` methods. Takes no arguments.

Instance methods are synchronous because, once the module is instantiated,
each call is a plain CPU-bound Wasm call.

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

Strips TypeScript types and lowers JSX for a single file. Import specifiers are
left untouched.

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

### `experimentalAnalyze(input): Promise<OxcResult<AnalyzeOutput>>` / `oxc.experimentalAnalyze(input)`

Returns semantic facts for a single source file: scopes, bindings, references,
unresolved references, imports, exports, and constrained JSX facts.

```ts
interface AnalyzeInput {
  filename: string;
  source: string;
  lang?: "js" | "jsx" | "ts" | "tsx"; // default: inferred from filename
  sourceType?: "module" | "script"; // default: "module"
}

interface AnalyzeOutput {
  scopes: ScopeFact[];
  bindings: BindingFact[];
  references: ReferenceFact[];
  unresolved: ReferenceFact[];
  imports: ImportFact[];
  exports: ExportFact[];
  jsxTags: JsxTagFact[];
}
```

See [`src/types.ts`](src/types.ts) for each fact's fields.

- Facts describe one file. `imports` and `exports` are recorded as written;
  specifiers are not resolved.
- Spans are JavaScript UTF-16 string offsets into `source`.
- `id`, `scopeId`, and `bindingId` are stable only within a single result.
- `BindingFact.kind` reports the declaration category when Oxc exposes one,
  including `"param"`, `"type"`, `"interface"`, `"enum"`, and
  `"enum-member"`.
- `ExportFact.kind` reports the export form (`"named"`, `"default"`, or
  `"all"`). `ExportFact.exportKind` reports `"value"` or `"type"`; for
  export specifiers this is the syntactic `type` marker as written, because
  specifiers are not resolved. `ExportFact.declarationKind` reports the
  declaration category for direct declaration exports.
- `JsxTagFact.span` is the opening tag span. `nameSpan` is the exact tag-name
  span. `elementSpan` covers the whole JSX element. Non-self-closing elements
  also include `closingSpan` and `closingNameSpan`.
- JSX tag facts include source-order `attributes` and `children`. Attribute
  values and child expressions expose spans only; expressions are not evaluated.
  JSX text facts expose syntax text, not React-rendered whitespace semantics.
- Intrinsic (lowercase) JSX tags are not bound to lexical variables. Component
  tags carry a `bindingId` only when Oxc semantic resolution resolves the tag;
  unresolved or type-only JSX names omit it.
- Absent optional fields are omitted, not set to `null`.
- This API is experimental; the fact shape may change in a minor version
  before it stabilizes. For why the analyzer stops at per-file facts, see
  [Scope and non-goals](#scope-and-non-goals).

### `OxcResult<T>`

Every call returns a discriminated result. Expected failures — syntax errors,
invalid transforms — are diagnostics, not thrown exceptions.

```ts
type OxcResult<T> =
  | { ok: true; value: T; diagnostics: OxcDiagnostic[] }
  | { ok: false; diagnostics: OxcDiagnostic[] };
```

A successful result can still carry warnings, so gate on `ok`, not on
`diagnostics.length`.

### `OxcDiagnostic`

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
       ├─ dist/wasm/analyze.wasm     (wasm32-unknown-unknown, 0 imports)
       └─ a small pointer/length/result ABI in JavaScript
```

Workers can't compile WebAssembly at runtime — no `WebAssembly.compile`, no
fetching `.wasm` over the network, no threads. That rules out the stock Oxc
WASI and browser builds, which expect one or more of those. `workerd-oxc`
sidesteps the problem by shipping Oxc as static, zero-import
`WebAssembly.Module` artifacts.

The `.wasm` files are Rust crates ([`native/`](native)) that wrap the Oxc
parser, transformer, and semantic analyzer and expose a handful of C-ABI
functions (`alloc`, `parse`/`transform`/`analyze`, `result_ptr`,
`free_result`, …). The TypeScript host writes UTF-8 into Wasm memory, calls in,
and reads a JSON result back out.

There is no N-API, no emnapi, no WASI, no runtime `WebAssembly.compile`, no
browser `Worker`, and no shared memory. The modules import nothing —
`WebAssembly.Module.imports(module)` is `[]` — which is what makes them
loadable in workerd.

## Scope and non-goals

`workerd-oxc` works on one file at a time. It parses a file, transforms a
file, and reports semantic facts about a file. That single-file boundary is
deliberate.

It is not a bundler, package manager, npm resolver, framework analyzer, or a
drop-in for Vite, esbuild, or Rolldown, and it does not:

- resolve modules or bundle
- resolve npm / `package.json` `exports`
- shim CJS/ESM interop
- handle CSS, assets, or `import.meta.url`
- rewrite dynamic `import()` / `require()`
- check types or reason across files
- evaluate JSX expressions or validate prop schemas
- decide application-specific component, route, deck, or document semantics

These are much larger problems, each with its own correctness burden. Folding
them into a per-file call tends to make that call mean less, not more: callers
can no longer tell whether a reported import was resolved, whether a type was
checked, or whether a fact holds for the file or the whole project. Keeping the
boundary sharp keeps the results trustworthy.

None of this is ruled out forever. Project-level or type-aware analysis could
be worth adding later — but as a separate API with its own contract, not as
hidden behaviour that `experimentalAnalyze` grows into. If you need resolution
or bundling today, reach for a real bundler; if you need cross-file analysis
today, this package is not it yet.

## Cloudflare Worker Loader

Because `transform` emits plain module source, its output can be loaded as a
[Dynamic Worker](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/).
See [`examples/worker-loader`](examples/worker-loader) for an end-to-end proof.
Loader wiring is left to you — it is not part of this package's API.

## Building from source

Requires Rust 1.95.0 with the `wasm32-unknown-unknown` target. The repo
includes `rust-toolchain.toml`, so `rustup` installs the right toolchain and
target automatically.

```sh
npm run build:wasm   # generates src/wasm/{parser,transform,analyze}.wasm
npm run build        # build:wasm, then copies artifacts into dist/wasm/
```

The artifacts are shipped in the npm package because Workers load them as
static `WebAssembly.Module` imports; runtime consumers never build them.
Inspect or verify them with:

```sh
npm run wasm:info    # size / hash / imports / exports per artifact
npm run wasm:check   # asserts zero imports and the expected ABI exports
```

## Contributing

The canonical check runs everything CI does:

```sh
npm run check
```

That is Oxlint, Oxfmt, Rust formatting, Wasm artifact checks, package-shape
checks, TypeScript, and the node and workerd test suites. Individual steps:

```sh
npm run lint          # Oxlint
npm run fmt           # Oxfmt + rustfmt (write)
npm run fmt:check     # Oxfmt + rustfmt (check)
npm test              # typecheck + node + workerd tests
npm run test:node
npm run test:workers
```

If you use [`just`](https://github.com/casey/just), a thin command facade
wraps the common tasks:

```sh
just check
just fmt
just build-wasm
```

Worker tests run under
[`@cloudflare/vitest-pool-workers`](https://github.com/cloudflare/workers-sdk).

## License

[MIT](LICENSE)
