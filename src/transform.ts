import transformModule from "./wasm/transform.wasm";

import { sourceLocationAtOffset, sourceSpan, runtimeDiagnostic, stringifyCause } from "./diagnostics.ts";
import type { OxcDiagnostic, OxcLanguage, OxcResult, SourceMapV3, TransformInput, TransformOutput } from "./types.ts";
import { instantiateAbiModule, type TransformAbiExports } from "./abi/instance.ts";
import { AbiMemoryScope } from "./abi/memory.ts";
import { readJsonResult } from "./abi/result.ts";
import { byteOffsetToStringOffset } from "./abi/utf8.ts";

interface DirectTransformDiagnostic {
  severity?: unknown;
  message?: unknown;
  file?: unknown;
  start?: unknown;
  end?: unknown;
}

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
  let exports = instantiateAbiModule<TransformAbiExports>(transformModule, "Oxc transform");

  return {
    transform(input) {
      try {
        return transformWithExports(exports, input);
      } catch (error) {
        try {
          exports = instantiateAbiModule<TransformAbiExports>(transformModule, "Oxc transform");
        } catch {
          // Preserve the original error in this call's diagnostic.
        }
        return { ok: false, diagnostics: [runtimeDiagnostic("runtime", "Oxc transform runtime failed.", error)] };
      }
    },
  };
}

function transformWithExports(exports: TransformAbiExports, input: TransformInput): OxcResult<TransformOutput> {
  if (Array.isArray(input.target)) {
    return {
      ok: false,
      diagnostics: [{
        phase: "transform",
        severity: "error",
        message: "Oxc transform target arrays are not supported by the workerd direct ABI yet. Pass a single target string.",
        filename: input.filename,
      }],
    };
  }

  const scope = new AbiMemoryScope(exports);
  try {
    const filename = scope.writeString(input.filename);
    const source = scope.writeString(input.source);
    const optionsJson = JSON.stringify(transformOptions(input));
    if (optionsJson === undefined) throw new Error("Oxc transform options must be JSON-serializable.");
    const options = scope.writeString(optionsJson);

    const handle = exports.transform(filename.ptr, filename.len, source.ptr, source.len, options.ptr, options.len);
    const payload = readJsonResult<DirectTransformPayload>(exports, handle);
    return transformPayload(input, payload);
  } finally {
    scope.dispose();
  }
}

function transformPayload(input: TransformInput, payload: DirectTransformPayload): OxcResult<TransformOutput> {
  const diagnostics = collectArrayLike(payload.diagnostics).map((diagnostic) => normalizeDiagnostic(input, diagnostic));

  if (payload.ok !== true || typeof payload.code !== "string") {
    return {
      ok: false,
      diagnostics: diagnostics.length > 0
        ? diagnostics
        : [{ phase: "transform", severity: "error", message: "Oxc transform failed without structured diagnostics.", filename: input.filename }],
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
    target: normalizeTarget(input.target),
    sourcemap: input.sourcemap ?? false,
    jsx: normalizeJsx(input.jsx),
  };
}

function normalizeTarget(target: TransformInput["target"]): string {
  return target ?? "es2022";
}

function normalizeJsx(jsx: TransformInput["jsx"]): unknown {
  if (jsx === "preserve") return "preserve";
  return {
    runtime: jsx?.runtime ?? "automatic",
    importSource: jsx?.importSource ?? "react",
    development: jsx?.development ?? false,
  };
}

function normalizeDiagnostic(input: TransformInput, value: unknown): OxcDiagnostic {
  const direct = value as DirectTransformDiagnostic;
  const start = typeof direct.start === "number" ? byteOffsetToStringOffset(input.source, direct.start) : undefined;
  const end = typeof direct.end === "number" ? byteOffsetToStringOffset(input.source, direct.end) : undefined;
  const location = start === undefined ? undefined : sourceLocationAtOffset(input.source, start);
  return {
    phase: "transform",
    severity: direct.severity === "warning" ? "warning" : "error",
    message: typeof direct.message === "string" ? direct.message : String(value),
    filename: typeof direct.file === "string" && direct.file.length > 0 ? direct.file : input.filename,
    location,
    span: start !== undefined && end !== undefined ? sourceSpan(input.source, start, end) : undefined,
    cause: stringifyCause(value),
  };
}

function isSourceMapV3(value: unknown): value is SourceMapV3 {
  return typeof value === "object" && value !== null &&
    (value as { version?: unknown }).version === 3 &&
    Array.isArray((value as { sources?: unknown }).sources) &&
    Array.isArray((value as { names?: unknown }).names) &&
    typeof (value as { mappings?: unknown }).mappings === "string";
}

function languageForFilename(filename: string): OxcLanguage {
  if (filename.endsWith(".tsx")) return "tsx";
  if (filename.endsWith(".ts") || filename.endsWith(".mts") || filename.endsWith(".cts")) return "ts";
  if (filename.endsWith(".jsx")) return "jsx";
  return "js";
}

function collectArrayLike(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
