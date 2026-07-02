import parserModule from "./wasm/parser.wasm";

import { collectArrayLike, normalizeNativeDiagnostic } from "./abi/diagnostics.ts";
import { createAbiOperationRuntime, isRuntimeError } from "./abi/operation.ts";
import { isTypeScriptFilename, languageForFilename, stringifyJsonOptions } from "./source.ts";
import type { OxcProgramAst, OxcResult, ParseInput, ParseOutput } from "./types.ts";
import type { ParserAbiExports } from "./abi/instance.ts";

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
  const runtime = createAbiOperationRuntime<ParserAbiExports>({
    module: parserModule,
    label: "Oxc parser",
  });

  return {
    parse(input) {
      const payload = runtime.call<DirectParsePayload>({
        filename: input.filename,
        source: input.source,
        optionsJson: stringifyJsonOptions(parseOptions(input), "Oxc parser"),
        invoke: (exports, args) => exports.parse(...args),
      });
      if (isRuntimeError(payload)) return { ok: false, diagnostics: [payload.runtimeError] };
      return parsePayload(input, payload);
    },
  };
}

function parsePayload(input: ParseInput, payload: DirectParsePayload): OxcResult<ParseOutput> {
  const rawProgramLength =
    typeof payload.rawProgramLength === "number" ? payload.rawProgramLength : 0;
  const diagnostics = collectArrayLike(payload.diagnostics).map((value) =>
    normalizeNativeDiagnostic({
      filename: input.filename,
      source: input.source,
      phase: "parse",
      value,
    }),
  );

  if (payload.ok !== true) {
    return {
      ok: false,
      diagnostics:
        diagnostics.length > 0
          ? diagnostics
          : [
              {
                phase: "parse",
                severity: "error",
                message: "Oxc parser failed without structured diagnostics.",
                filename: input.filename,
              },
            ],
    };
  }

  const ast = materializeOxcAstPayload(payload.payload as OxcJsonAstPayload);
  if (!isProgramAst(ast)) {
    return {
      ok: false,
      diagnostics: [
        {
          phase: "parse",
          severity: "error",
          message: "Oxc parser payload did not materialize to a Program AST.",
          filename: input.filename,
        },
      ],
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
  const literal = node as {
    bigint?: string;
    regex?: { pattern?: string; flags?: string };
    value?: unknown;
  };
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
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "Program" &&
    Array.isArray((value as { body?: unknown }).body)
  );
}
