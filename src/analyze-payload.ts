import { collectArrayLike, normalizeNativeDiagnostic } from "./abi/diagnostics.ts";
import type { AnalyzeInput, AnalyzeOutput, OxcResult } from "./types.ts";

interface AnalyzeFailurePayload {
  ok?: unknown;
  diagnostics?: unknown;
}

interface AnalyzeSuccessPayload extends AnalyzeFailurePayload {
  scopes?: unknown;
  bindings?: unknown;
  references?: unknown;
  unresolved?: unknown;
  imports?: unknown;
  exports?: unknown;
  jsxTags?: unknown;
}

export function parseAnalyzePayload(
  input: AnalyzeInput,
  payload: unknown,
): OxcResult<AnalyzeOutput> {
  if (!isObject(payload)) {
    return malformedAnalyzePayload(input);
  }

  const direct = payload as AnalyzeSuccessPayload;
  const diagnostics = collectArrayLike(direct.diagnostics).map((value) =>
    normalizeNativeDiagnostic({
      filename: input.filename,
      source: input.source,
      phase: "analyze",
      value,
    }),
  );

  if (direct.ok !== true) {
    return {
      ok: false,
      diagnostics:
        diagnostics.length > 0
          ? diagnostics
          : [
              {
                phase: "analyze",
                severity: "error",
                message: "Oxc analyzer failed without structured diagnostics.",
                filename: input.filename,
              },
            ],
    };
  }

  if (!isAnalyzeOutput(direct)) {
    return malformedAnalyzePayload(input);
  }

  return {
    ok: true,
    value: {
      scopes: direct.scopes,
      bindings: direct.bindings,
      references: direct.references,
      unresolved: direct.unresolved,
      imports: direct.imports,
      exports: direct.exports,
      jsxTags: direct.jsxTags,
    },
    diagnostics,
  };
}

export const parseAnalyzePayloadForTest = parseAnalyzePayload;

function isAnalyzeOutput(
  value: AnalyzeSuccessPayload,
): value is AnalyzeSuccessPayload & AnalyzeOutput {
  return (
    Array.isArray(value.scopes) &&
    Array.isArray(value.bindings) &&
    Array.isArray(value.references) &&
    Array.isArray(value.unresolved) &&
    Array.isArray(value.imports) &&
    value.imports.every(isImportFact) &&
    Array.isArray(value.exports) &&
    value.exports.every(isExportFact) &&
    Array.isArray(value.jsxTags) &&
    value.jsxTags.every(isJsxTag)
  );
}

function malformedAnalyzePayload(input: AnalyzeInput): OxcResult<AnalyzeOutput> {
  return {
    ok: false,
    diagnostics: [
      {
        phase: "runtime",
        severity: "error",
        message: "Malformed Oxc analyzer payload.",
        filename: input.filename,
      },
    ],
  };
}

function isImportFact(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (typeof value.source !== "string" || typeof value.local !== "string") return false;
  if (value.kind !== "value" && value.kind !== "type") return false;

  switch (value.specifierKind) {
    case "named":
      return typeof value.imported === "string";
    case "default":
    case "namespace":
      return value.imported === undefined;
    default:
      return false;
  }
}

function isExportFact(value: unknown): boolean {
  if (!isObject(value)) return false;

  switch (value.kind) {
    case "named":
      return typeof value.local === "string" && typeof value.exported === "string";
    case "default":
      return value.exported === "default" && value.source === undefined;
    case "all":
      return (
        value.local === undefined &&
        typeof value.source === "string" &&
        (value.exported === undefined || typeof value.exported === "string")
      );
    default:
      return false;
  }
}

function isJsxTag(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (!Array.isArray(value.attributes) || !Array.isArray(value.children)) return false;
  return value.attributes.every(isJsxAttribute) && value.children.every(isJsxChild);
}

function isJsxAttribute(value: unknown): boolean {
  if (!isObject(value) || typeof value.kind !== "string") return false;
  if (value.kind === "spread") return true;
  if (value.kind !== "attribute") return false;
  return value.value === undefined || isJsxAttributeValue(value.value);
}

function isJsxAttributeValue(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.kind === "expression") {
    return value.literal === undefined || isLiteralValueFact(value.literal);
  }
  return value.kind === "string" || value.kind === "element" || value.kind === "fragment";
}

function isJsxChild(value: unknown): boolean {
  if (!isObject(value)) return false;
  switch (value.kind) {
    case "text":
    case "element":
    case "spread":
      return true;
    case "expression":
      return value.literal === undefined || isLiteralValueFact(value.literal);
    case "fragment":
      return Array.isArray(value.children) && value.children.every(isJsxChild);
    default:
      return false;
  }
}

function isLiteralValueFact(value: unknown): boolean {
  if (!isObject(value)) return false;
  switch (value.type) {
    case "string":
      return typeof value.value === "string";
    case "number":
      return (
        typeof value.value === "number" &&
        Number.isFinite(value.value) &&
        !Object.is(value.value, -0)
      );
    case "boolean":
      return typeof value.value === "boolean";
    case "null":
      return true;
    case "array":
      return Array.isArray(value.elements) && value.elements.every(isLiteralValueFact);
    case "object":
      return Array.isArray(value.properties) && value.properties.every(isLiteralProperty);
    default:
      return false;
  }
}

function isLiteralProperty(value: unknown): boolean {
  return isObject(value) && typeof value.key === "string" && isLiteralValueFact(value.value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
