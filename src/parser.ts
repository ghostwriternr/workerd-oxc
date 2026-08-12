import parserModule from "@oxc-parser/binding-wasm32-wasip1/wasm.wasm";
import { dispose, instantiate } from "@oxc-parser/binding-wasm32-wasip1/workerd";

import { normalizeNativeDiagnostic } from "./abi/diagnostics.ts";
import { runtimeDiagnostic } from "./diagnostics.ts";
import { isTypeScriptFilename, languageForFilename } from "./source.ts";
import type { OxcProgramAst, OxcResult, ParseInput, ParseOutput } from "./types.ts";

type ParserBinding = Awaited<ReturnType<typeof instantiate>>;

interface OxcJsonAstPayload {
  node?: unknown;
  fixes?: Array<Array<string | number>>;
}

export interface ParserRuntime {
  parse(input: ParseInput): Promise<OxcResult<ParseOutput>>;
}

let bindingPromise: Promise<ParserBinding> | undefined;

export function createParserRuntime(): ParserRuntime {
  return {
    async parse(input) {
      try {
        const parser = await getBinding();
        const result = parser.parseSync(input.filename, input.source, parseOptions(input));
        const diagnostics = result.errors.map((value) =>
          normalizeNativeDiagnostic({
            filename: input.filename,
            source: input.source,
            phase: "parse",
            offsetEncoding: "utf16",
            value,
          }),
        );

        if (diagnostics.some(({ severity }) => severity === "error")) {
          return { ok: false, diagnostics };
        }

        const rawProgram = result.program as unknown;
        const rawProgramLength =
          typeof rawProgram === "string"
            ? new TextEncoder().encode(String(rawProgram)).byteLength
            : 0;
        const ast = materializeProgram(rawProgram);
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
      } catch (error) {
        return {
          ok: false,
          diagnostics: [runtimeDiagnostic("parse", "Oxc parser runtime failed.", error)],
        };
      }
    },
  };
}

function getBinding(): Promise<ParserBinding> {
  bindingPromise ??= instantiate(parserModule).catch(async (error: unknown) => {
    bindingPromise = undefined;
    await dispose().catch(() => undefined);
    throw error;
  });
  return bindingPromise;
}

function parseOptions(input: ParseInput) {
  return {
    lang: input.lang ?? languageForFilename(input.filename),
    sourceType: input.sourceType ?? "module",
    astType: input.astType ?? (isTypeScriptFilename(input.filename) ? "ts" : "js"),
    range: input.range ?? false,
    preserveParens: input.preserveParens ?? false,
  } as const;
}

function materializeProgram(rawProgram: unknown): unknown {
  if (typeof rawProgram !== "string") return rawProgram;

  const payload = JSON.parse(String(rawProgram)) as OxcJsonAstPayload;
  const { node, fixes = [] } = payload;
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
