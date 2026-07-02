import parserModule from "./wasm/parser.wasm";

import { sourceLocationAtOffset, sourceSpan, runtimeDiagnostic, stringifyCause } from "./diagnostics.ts";
import type { OxcDiagnostic, OxcLanguage, OxcProgramAst, OxcResult, ParseInput, ParseOutput } from "./types.ts";
import { instantiateAbiModule, type ParserAbiExports } from "./abi/instance.ts";
import { AbiMemoryScope } from "./abi/memory.ts";
import { readJsonResult } from "./abi/result.ts";
import { byteOffsetToStringOffset } from "./abi/utf8.ts";

interface DirectParseDiagnostic {
  severity?: unknown;
  message?: unknown;
  file?: unknown;
  start?: unknown;
  end?: unknown;
}

interface DirectParsePayload {
  abiVersion?: unknown;
  kind?: unknown;
  ok?: unknown;
  rawProgramLength?: unknown;
  payload?: unknown;
  diagnostics?: unknown;
}

interface OxcJsonAstPayload {
  node?: unknown;
  fixes?: Array<Array<string | number>>;
}

export interface ParserRuntime {
  parse(input: ParseInput): OxcResult<ParseOutput>;
}

export function createParserRuntime(): ParserRuntime {
  let exports = instantiateAbiModule<ParserAbiExports>(parserModule, "Oxc parser");

  return {
    parse(input) {
      try {
        return parseWithExports(exports, input);
      } catch (error) {
        // Traps or malformed host inputs may leave linear memory state uncertain.
        // Recreate the instance before the next call.
        try {
          exports = instantiateAbiModule<ParserAbiExports>(parserModule, "Oxc parser");
        } catch {
          // Preserve the original error in this call's diagnostic.
        }
        return { ok: false, diagnostics: [runtimeDiagnostic("runtime", "Oxc parser runtime failed.", error)] };
      }
    },
  };
}

function parseWithExports(exports: ParserAbiExports, input: ParseInput): OxcResult<ParseOutput> {
  const scope = new AbiMemoryScope(exports);
  try {
    const filename = scope.writeString(input.filename);
    const source = scope.writeString(input.source);
    const optionsJson = JSON.stringify(parseOptions(input));
    if (optionsJson === undefined) throw new Error("Oxc parser options must be JSON-serializable.");
    const options = scope.writeString(optionsJson);

    const handle = exports.parse(filename.ptr, filename.len, source.ptr, source.len, options.ptr, options.len);
    const payload = readJsonResult<DirectParsePayload>(exports, handle);
    return parsePayload(input, payload);
  } finally {
    scope.dispose();
  }
}

function parsePayload(input: ParseInput, payload: DirectParsePayload): OxcResult<ParseOutput> {
  const rawProgramLength = typeof payload.rawProgramLength === "number" ? payload.rawProgramLength : 0;
  const diagnostics = collectArrayLike(payload.diagnostics).map((diagnostic) => normalizeDiagnostic(input, diagnostic));

  if (payload.ok !== true) {
    return {
      ok: false,
      diagnostics: diagnostics.length > 0
        ? diagnostics
        : [{ phase: "parse", severity: "error", message: "Oxc parser failed without structured diagnostics.", filename: input.filename }],
    };
  }

  const ast = materializeOxcAstPayload(payload.payload as OxcJsonAstPayload);
  if (!isProgramAst(ast)) {
    return {
      ok: false,
      diagnostics: [{ phase: "parse", severity: "error", message: "Oxc parser payload did not materialize to a Program AST.", filename: input.filename }],
    };
  }

  return { ok: true, value: { ast, rawProgramLength }, diagnostics };
}

function parseOptions(input: ParseInput): Record<string, unknown> {
  return {
    lang: input.lang ?? languageForFilename(input.filename),
    sourceType: input.sourceType ?? "module",
    astType: input.astType ?? (isTypeScriptFilename(input.filename) ? "ts" : "js"),
    range: input.range ?? false,
    preserveParens: input.preserveParens ?? false,
  };
}

function normalizeDiagnostic(input: ParseInput, value: unknown): OxcDiagnostic {
  const direct = value as DirectParseDiagnostic;
  const start = typeof direct.start === "number" ? byteOffsetToStringOffset(input.source, direct.start) : undefined;
  const end = typeof direct.end === "number" ? byteOffsetToStringOffset(input.source, direct.end) : undefined;
  const location = start === undefined ? undefined : sourceLocationAtOffset(input.source, start);
  return {
    phase: "parse",
    severity: direct.severity === "warning" ? "warning" : "error",
    message: typeof direct.message === "string" ? direct.message : String(value),
    filename: typeof direct.file === "string" && direct.file.length > 0 ? direct.file : input.filename,
    location,
    span: start !== undefined && end !== undefined ? sourceSpan(input.source, start, end) : undefined,
    cause: stringifyCause(value),
  };
}

function materializeOxcAstPayload({ node, fixes = [] }: OxcJsonAstPayload): unknown {
  if (node !== undefined) {
    for (const fixPath of fixes) applyLiteralFix(node, fixPath);
  }
  return node;
}

function applyLiteralFix(program: unknown, fixPath: Array<string | number>): void {
  let node: unknown = program;
  for (const key of fixPath) {
    if (typeof node !== "object" || node === null) return;
    node = (node as Record<string | number, unknown>)[key];
  }

  if (typeof node !== "object" || node === null) return;
  const literal = node as { bigint?: string; regex?: { pattern?: string; flags?: string }; value?: unknown };
  if (literal.bigint) {
    literal.value = BigInt(literal.bigint);
    return;
  }
  if (literal.regex) {
    try {
      literal.value = RegExp(literal.regex.pattern ?? "", literal.regex.flags ?? "");
    } catch {
      // Match Oxc's JS wrapper: leave value untouched if the host cannot build this RegExp value.
    }
  }
}

function isProgramAst(value: unknown): value is OxcProgramAst {
  return typeof value === "object" && value !== null &&
    (value as { type?: unknown }).type === "Program" &&
    Array.isArray((value as { body?: unknown }).body);
}

function languageForFilename(filename: string): OxcLanguage {
  if (filename.endsWith(".tsx")) return "tsx";
  if (filename.endsWith(".ts") || filename.endsWith(".mts") || filename.endsWith(".cts")) return "ts";
  if (filename.endsWith(".jsx")) return "jsx";
  return "js";
}

function isTypeScriptFilename(filename: string): boolean {
  return filename.endsWith(".ts") || filename.endsWith(".tsx") || filename.endsWith(".mts") || filename.endsWith(".cts");
}

function collectArrayLike(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
