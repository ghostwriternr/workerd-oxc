import transformModule from "./wasm/transform.wasm";

import { collectArrayLike, normalizeNativeDiagnostic } from "./abi/diagnostics.ts";
import { createAbiOperationRuntime, isRuntimeError } from "./abi/operation.ts";
import { languageForFilename, stringifyJsonOptions } from "./source.ts";
import type { OxcResult, SourceMapV3, TransformInput, TransformOutput } from "./types.ts";
import type { TransformAbiExports } from "./abi/instance.ts";

interface DirectTransformPayload {
  abiVersion?: unknown;
  kind?: unknown;
  ok?: unknown;
  code?: unknown;
  map?: unknown;
  diagnostics?: unknown;
}

export interface TransformRuntime {
  transform(input: TransformInput): OxcResult<TransformOutput>;
}

export function createTransformRuntime(): TransformRuntime {
  const runtime = createAbiOperationRuntime<TransformAbiExports>({
    module: transformModule,
    label: "Oxc transform",
  });

  return {
    transform(input) {
      if (Array.isArray(input.target)) {
        return {
          ok: false,
          diagnostics: [
            {
              phase: "transform",
              severity: "error",
              message:
                "Oxc transform target arrays are not supported by the workerd direct ABI yet. Pass a single target string.",
              filename: input.filename,
            },
          ],
        };
      }

      const payload = runtime.call<DirectTransformPayload>({
        filename: input.filename,
        source: input.source,
        optionsJson: stringifyJsonOptions(transformOptions(input), "Oxc transform"),
        invoke: (exports, args) => exports.transform(...args),
      });
      if (isRuntimeError(payload)) return { ok: false, diagnostics: [payload.runtimeError] };
      return transformPayload(input, payload);
    },
  };
}

function transformPayload(
  input: TransformInput,
  payload: DirectTransformPayload,
): OxcResult<TransformOutput> {
  const diagnostics = collectArrayLike(payload.diagnostics).map((value) =>
    normalizeNativeDiagnostic({
      filename: input.filename,
      source: input.source,
      phase: "transform",
      value,
    }),
  );

  if (payload.ok !== true || typeof payload.code !== "string") {
    return {
      ok: false,
      diagnostics:
        diagnostics.length > 0
          ? diagnostics
          : [
              {
                phase: "transform",
                severity: "error",
                message: "Oxc transform failed without structured diagnostics.",
                filename: input.filename,
              },
            ],
    };
  }

  const output: TransformOutput = { code: payload.code };
  if (isSourceMapV3(payload.map)) output.map = payload.map;
  return { ok: true, value: output, diagnostics };
}

function transformOptions(input: TransformInput): Record<string, unknown> {
  return {
    lang: input.lang ?? languageForFilename(input.filename),
    sourceType: input.sourceType ?? "module",
    target: input.target ?? "es2022",
    sourcemap: input.sourcemap ?? false,
    jsx: normalizeJsx(input.jsx),
  };
}

function normalizeJsx(jsx: TransformInput["jsx"]): unknown {
  if (jsx === "preserve") return "preserve";
  return {
    runtime: jsx?.runtime ?? "automatic",
    importSource: jsx?.importSource ?? "react",
    development: jsx?.development ?? false,
  };
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
