import { diagnostic, evidence, stringifyCause } from "../diagnostics.ts";
import type { OxcProgramAst, ParseAstResult, ParseOptions, ToolchainDiagnostic, ToolchainEvidence } from "../types.ts";
import type { DirectParseDiagnostic } from "./direct-parser-runtime.ts";
import { getOxcParser } from "./runtime.ts";

interface OxcJsonAstPayload {
  node?: unknown;
  fixes?: Array<Array<string | number>>;
}

export async function parseReactTsxAst(filename: string, source: string, options: ParseOptions = {}): Promise<ParseAstResult> {
  const events: ToolchainEvidence[] = [];
  const importStarted = performance.now();
  let parser;

  try {
    parser = await getOxcParser();
    events.push(evidence("oxc-parser", "import", true, importStarted, "instantiated oxc-parser wasm through @alexbruf/wasmkernel"));
  } catch (error) {
    events.push(evidence("oxc-parser", "import", false, importStarted));
    return {
      ok: false,
      diagnostics: [diagnostic("oxc-parser", "import-failed", "Could not initialize Oxc parser in workerd.", error)],
      evidence: events,
    };
  }

  const parseStarted = performance.now();
  try {
    if (typeof parser.parseSync !== "function") throw new Error("Oxc parser export parseSync is unavailable.");
    const result = parser.parseSync(filename, source, parseOptions(filename, options));
    const errors = collectArrayLike(result.errors);

    // Oxc's raw N-API getter is one-shot. Read it exactly once here and never
    // expose the footgun to callers.
    const programJson = result.program;
    const rawProgramLength = typeof programJson === "string" ? new TextEncoder().encode(programJson).byteLength : 0;

    if (errors.length > 0) {
      events.push(evidence("oxc-parser", "parse", false, parseStarted, `${errors.length} parser errors`));
      return {
        ok: false,
        rawProgramLength,
        diagnostics: errors.map((error) => parseErrorDiagnostic(filename, error)),
        evidence: events,
      };
    }

    if (typeof programJson !== "string" || programJson.length === 0) {
      events.push(evidence("oxc-parser", "parse", false, parseStarted, "empty raw program string"));
      return {
        ok: false,
        rawProgramLength,
        diagnostics: [diagnostic("oxc-parser", "parse-failed", "Oxc parser returned an empty raw program string before AST materialization.")],
        evidence: events,
      };
    }

    const ast = materializeOxcAst(programJson);
    if (!isProgramAst(ast)) {
      events.push(evidence("oxc-parser", "parse", false, parseStarted, "JSON did not materialize to Program"));
      return {
        ok: false,
        rawProgramLength,
        diagnostics: [diagnostic("oxc-parser", "parse-failed", "Oxc parser JSON did not materialize to a Program AST.")],
        evidence: events,
      };
    }

    events.push(evidence("oxc-parser", "parse", true, parseStarted, `materialized ${rawProgramLength} bytes of Oxc AST JSON`));
    return { ok: true, ast, rawProgramLength, diagnostics: [], evidence: events };
  } catch (error) {
    events.push(evidence("oxc-parser", "parse", false, parseStarted));
    return {
      ok: false,
      diagnostics: [diagnostic("oxc-parser", "parse-failed", "Oxc parser failed to materialize a TSX AST in workerd.", error)],
      evidence: events,
    };
  }
}

export async function experimentalParseReactTsxAstDirect(filename: string, source: string, options: ParseOptions = {}): Promise<ParseAstResult> {
  const events: ToolchainEvidence[] = [];
  const importStarted = performance.now();

  try {
    const { getDirectParser } = await import("./direct-parser-runtime.ts");
    await getDirectParser();
    events.push(evidence("oxc-parser", "import", true, importStarted, "instantiated oxc-parser wasm through direct ABI"));
  } catch (error) {
    events.push(evidence("oxc-parser", "import", false, importStarted));
    return {
      ok: false,
      diagnostics: [diagnostic("oxc-parser", "import-failed", "Could not initialize Oxc direct parser in workerd.", error)],
      evidence: events,
    };
  }

  const parseStarted = performance.now();
  try {
    const { parseWithDirectParser } = await import("./direct-parser-runtime.ts");
    const result = await parseWithDirectParser(filename, source, parseOptions(filename, options));
    const rawProgramLength = typeof result.rawProgramLength === "number" ? result.rawProgramLength : 0;

    if (result.ok !== true) {
      const directDiagnostics = collectArrayLike(result.diagnostics);
      events.push(evidence("oxc-parser", "parse", false, parseStarted, `${directDiagnostics.length} direct parser errors`));
      return {
        ok: false,
        rawProgramLength,
        diagnostics: directDiagnostics.length > 0
          ? directDiagnostics.map((directDiagnostic) => directParseDiagnostic(filename, directDiagnostic))
          : [diagnostic("oxc-parser", "parse-failed", "Oxc direct parser failed without structured diagnostics.")],
        evidence: events,
      };
    }

    const ast = materializeOxcAstPayload(result.payload as OxcJsonAstPayload);
    if (!isProgramAst(ast)) {
      events.push(evidence("oxc-parser", "parse", false, parseStarted, "direct payload did not materialize to Program"));
      return {
        ok: false,
        rawProgramLength,
        diagnostics: [diagnostic("oxc-parser", "parse-failed", "Oxc direct parser payload did not materialize to a Program AST.")],
        evidence: events,
      };
    }

    events.push(evidence("oxc-parser", "parse", true, parseStarted, `materialized ${rawProgramLength} bytes of Oxc AST JSON through direct ABI`));
    return { ok: true, ast, rawProgramLength, diagnostics: [], evidence: events };
  } catch (error) {
    events.push(evidence("oxc-parser", "parse", false, parseStarted));
    return {
      ok: false,
      diagnostics: [diagnostic("oxc-parser", "parse-failed", "Oxc direct parser failed to materialize a TSX AST in workerd.", error)],
      evidence: events,
    };
  }
}

function materializeOxcAst(programJson: string): unknown {
  return materializeOxcAstPayload(JSON.parse(programJson) as OxcJsonAstPayload);
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
      // Match Oxc's JS wrapper: leave value untouched if the host cannot build
      // this RegExp value.
    }
  }
}

function parseOptions(filename: string, options: ParseOptions): Record<string, unknown> {
  return {
    lang: languageForFilename(filename),
    sourceType: "module",
    astType: filename.endsWith(".ts") || filename.endsWith(".tsx") || filename.endsWith(".mts") ? "ts" : "js",
    ...options,
  };
}

function languageForFilename(filename: string): "js" | "jsx" | "ts" | "tsx" {
  if (filename.endsWith(".tsx")) return "tsx";
  if (filename.endsWith(".ts") || filename.endsWith(".mts")) return "ts";
  if (filename.endsWith(".jsx")) return "jsx";
  return "js";
}

function isProgramAst(value: unknown): value is OxcProgramAst {
  return typeof value === "object" && value !== null &&
    (value as { type?: unknown }).type === "Program" &&
    Array.isArray((value as { body?: unknown }).body);
}

function parseErrorDiagnostic(filename: string, error: unknown): ToolchainDiagnostic {
  return {
    tool: "oxc-parser",
    kind: "parse-failed",
    severity: "error",
    message: String(error),
    file: filename,
    cause: stringifyCause(error),
  };
}

function directParseDiagnostic(filename: string, value: unknown): ToolchainDiagnostic {
  const direct = value as DirectParseDiagnostic;
  return {
    tool: "oxc-parser",
    kind: "parse-failed",
    severity: direct.severity === "warning" ? "warning" : "error",
    message: typeof direct.message === "string" ? direct.message : String(value),
    file: typeof direct.file === "string" && direct.file.length > 0 ? direct.file : filename,
    span: typeof direct.start === "number" && typeof direct.end === "number"
      ? { start: direct.start, end: direct.end }
      : undefined,
  };
}

function collectArrayLike(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return [];

  if (Symbol.iterator in value && typeof value[Symbol.iterator] === "function") {
    const iterated = Array.from(value as Iterable<unknown>);
    if (iterated.length > 0) return iterated;
  }

  const items: unknown[] = [];
  const indexable = value as Record<number, unknown>;
  for (let index = 0; index < 1000; index += 1) {
    const item = indexable[index];
    if (item === undefined) break;
    items.push(item);
  }
  return items;
}
