import transformModule from "@oxc-transform/binding-wasm32-wasip1/wasm.wasm";
import { dispose, instantiate } from "@oxc-transform/binding-wasm32-wasip1/workerd";

import { normalizeNativeDiagnostic } from "./abi/diagnostics.ts";
import { runtimeDiagnostic } from "./diagnostics.ts";
import { languageForFilename } from "./source.ts";
import type { OxcResult, SourceMapV3, TransformInput, TransformOutput } from "./types.ts";

type TransformBinding = Awaited<ReturnType<typeof instantiate>>;

export interface TransformRuntime {
  transform(input: TransformInput): Promise<OxcResult<TransformOutput>>;
}

let bindingPromise: Promise<TransformBinding> | undefined;

export function createTransformRuntime(): TransformRuntime {
  return {
    async transform(input) {
      if (Array.isArray(input.target)) {
        return {
          ok: false,
          diagnostics: [
            {
              phase: "transform",
              severity: "error",
              message:
                "Oxc transform target arrays are not supported. Pass a single target string.",
              filename: input.filename,
            },
          ],
        };
      }

      try {
        const transformer = await getBinding();
        const result = transformer.transformSync(
          input.filename,
          input.source,
          transformOptions(input),
        );
        const diagnostics = result.errors.map((value) =>
          normalizeNativeDiagnostic({
            filename: input.filename,
            source: input.source,
            phase: "transform",
            offsetEncoding: "utf8",
            value,
          }),
        );

        if (diagnostics.some(({ severity }) => severity === "error")) {
          return { ok: false, diagnostics };
        }

        const output: TransformOutput = { code: result.code };
        if (isSourceMapV3(result.map)) output.map = result.map;
        return { ok: true, value: output, diagnostics };
      } catch (error) {
        return {
          ok: false,
          diagnostics: [runtimeDiagnostic("transform", "Oxc transform runtime failed.", error)],
        };
      }
    },
  };
}

function getBinding(): Promise<TransformBinding> {
  bindingPromise ??= instantiate(transformModule).catch(async (error: unknown) => {
    bindingPromise = undefined;
    await dispose().catch(() => undefined);
    throw error;
  });
  return bindingPromise;
}

function transformOptions(input: TransformInput) {
  return {
    lang: input.lang ?? languageForFilename(input.filename),
    sourceType: input.sourceType ?? "module",
    target: input.target ?? "es2022",
    sourcemap: input.sourcemap ?? false,
    jsx: normalizeJsx(input.jsx),
  } as const;
}

function normalizeJsx(jsx: TransformInput["jsx"]) {
  if (jsx === "preserve") return "preserve" as const;
  return {
    runtime: jsx?.runtime ?? "automatic",
    importSource: jsx?.importSource ?? "react",
    development: jsx?.development ?? false,
  } as const;
}

function isSourceMapV3(value: unknown): value is SourceMapV3 {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 3 &&
    Array.isArray((value as { sources?: unknown }).sources) &&
    Array.isArray((value as { names?: unknown }).names) &&
    typeof (value as { mappings?: unknown }).mappings === "string"
  );
}
