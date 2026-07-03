import { describe, expect, test, vi } from "vitest";

import type {
  AnalyzeInput,
  AnalyzeOutput,
  BindingFact,
  ExportFact,
  ImportFact,
  JsxAttributeFact,
  JsxAttributeValueFact,
  JsxChildFact,
  LiteralValueFact,
  OxcDiagnostic,
  OxcResult,
  ReferenceFact,
  TransformInput,
} from "../../src/index";
import { createOxc, experimentalAnalyze } from "../../src/index";

vi.mock("../../src/abi/instance.ts", () => ({
  instantiateAbiModule: () => ({
    abi_version: () => 1,
    alloc: () => 0,
    free: () => {},
    result_ptr: () => 0,
    result_len: () => 0,
    free_result: () => {},
    parse: () => 0,
    transform: () => 0,
    analyze: () => 0,
    memory: {
      buffer: new ArrayBuffer(65536),
    },
  }),
}));

// @ts-expect-error CreateOxcOptions is intentionally not exported.
import type { CreateOxcOptions as MissingCreateOxcOptions } from "../../src/index";

type MissingOptionsExport = MissingCreateOxcOptions;

describe("public API types", () => {
  void (undefined as MissingOptionsExport | undefined);

  test("analyze types align with top-level and instance signatures", async () => {
    const input: AnalyzeInput = { filename: "src/app.tsx", source: "const x = 1;" };
    const topLevel: Promise<OxcResult<AnalyzeOutput>> = experimentalAnalyze(input);
    const instance = await createOxc();
    const instanceResult: Promise<OxcResult<AnalyzeOutput>> = instance.experimentalAnalyze(input);
    void topLevel;
    void instanceResult;
    expect(true).toBe(true);
  });
  test("analyzer fact kinds expose semantic variants", () => {
    const binding: BindingFact = {
      id: 1,
      name: "props",
      kind: "param",
      flags: ["variable"],
      scopeId: 0,
      span: { start: 0, end: 5 },
      references: [],
    };
    const exportedType: ExportFact = {
      kind: "named",
      local: "SlideProps",
      exported: "SlideProps",
      exportKind: "type",
      declarationKind: "interface",
      span: { start: 0, end: 32 },
    };
    const namedImport: ImportFact = {
      source: "./mod",
      local: "localName",
      imported: "exportedName",
      specifierKind: "named",
      kind: "value",
      span: { start: 0, end: 10 },
      sourceSpan: { start: 12, end: 19 },
    };
    const defaultImport: ImportFact = {
      source: "./mod",
      local: "DefaultThing",
      specifierKind: "default",
      kind: "value",
      span: { start: 0, end: 10 },
      sourceSpan: { start: 12, end: 19 },
    };
    const allExport: ExportFact = {
      kind: "all",
      source: "./mod",
      exportKind: "value",
      span: { start: 0, end: 22 },
    };
    const analyzeDiagnosticPhase: OxcDiagnostic["phase"] = "analyze";

    // @ts-expect-error analyzer does not emit catch-all binding kind strings.
    const invalidBinding: BindingFact = { ...binding, kind: "parameter" };
    // @ts-expect-error export form and type/value category are separate fields.
    const invalidExportKind: ExportFact = { ...exportedType, kind: "interface" };
    // @ts-expect-error exportKind is value/type, not declaration syntax.
    const invalidExportValueKind: ExportFact = { ...exportedType, exportKind: "interface" };
    const invalidExportDeclarationKind: ExportFact = {
      ...exportedType,
      // @ts-expect-error declarationKind only contains direct export declaration categories.
      declarationKind: "enum-member",
    };
    // @ts-expect-error all exports must not have a local binding.
    const invalidAllExport: ExportFact = {
      kind: "all",
      local: "x",
      source: "./x",
      span: { start: 0, end: 1 },
    };
    const invalidDefaultImport: ImportFact = {
      source: "./mod",
      local: "x",
      // @ts-expect-error default imports do not use imported sentinel strings.
      imported: "default",
      specifierKind: "default",
      kind: "value",
      span: { start: 0, end: 1 },
      sourceSpan: { start: 0, end: 1 },
    };

    expect(binding.kind).toBe("param");
    expect(exportedType.exportKind).toBe("type");
    expect(namedImport.specifierKind).toBe("named");
    expect(defaultImport.specifierKind).toBe("default");
    expect(allExport.kind).toBe("all");
    expect(analyzeDiagnosticPhase).toBe("analyze");
    expect(invalidBinding.kind).toBe("parameter");
    expect(invalidExportKind.kind).toBe("interface");
    expect(invalidExportValueKind.exportKind).toBe("interface");
    expect((invalidExportDeclarationKind as { declarationKind?: unknown }).declarationKind).toBe(
      "enum-member",
    );
    expect(invalidAllExport.kind).toBe("all");
    expect(invalidDefaultImport.specifierKind).toBe("default");
  });

  test("reference kind only exposes emitted analyzer variants", () => {
    const identifierReference: ReferenceFact = {
      id: 1,
      name: "value",
      kind: "identifier",
      flags: ["read"],
      scopeId: 0,
      span: { start: 0, end: 5 },
    };
    const typeReference: ReferenceFact = { ...identifierReference, kind: "type" };

    // @ts-expect-error analyzer does not currently emit distinct JSX reference kinds.
    const jsxReference: ReferenceFact = { ...identifierReference, kind: "jsx" };
    // @ts-expect-error analyzer does not currently emit namespace reference kinds.
    const namespaceReference: ReferenceFact = { ...identifierReference, kind: "namespace" };

    expect(identifierReference.kind).toBe("identifier");
    expect(typeReference.kind).toBe("type");
    expect(jsxReference.kind).toBe("jsx");
    expect(namespaceReference.kind).toBe("namespace");
  });

  test("jsx analyzer fact types expose constrained variants", () => {
    const stringValue: JsxAttributeValueFact = {
      kind: "string",
      value: "wide",
      span: { start: 12, end: 18 },
    };
    const expressionValue: JsxAttributeValueFact = {
      kind: "expression",
      span: { start: 20, end: 25 },
      expressionSpan: { start: 21, end: 24 },
    };
    const literalValue: JsxAttributeValueFact = {
      kind: "expression",
      span: { start: 20, end: 40 },
      expressionSpan: { start: 21, end: 39 },
      literal: {
        type: "object",
        properties: [
          { key: "x", value: { type: "number", value: 80 } },
          { key: "label", value: { type: "string", value: "hi" } },
          { key: "on", value: { type: "boolean", value: true } },
          { key: "none", value: { type: "null" } },
          { key: "items", value: { type: "array", elements: [{ type: "number", value: 1 }] } },
        ],
      },
    };
    const nestedLiteral: LiteralValueFact = { type: "array", elements: [{ type: "null" }] };
    const literalChild: JsxChildFact = {
      kind: "expression",
      span: { start: 0, end: 3 },
      literal: { type: "number", value: 7 },
    };
    // @ts-expect-error literal value objects use { key, value } property facts.
    const invalidLiteral: LiteralValueFact = { type: "object", properties: [{ name: "x" }] };
    const attribute: JsxAttributeFact = {
      kind: "attribute",
      name: "size",
      nameSpan: { start: 7, end: 11 },
      span: { start: 7, end: 18 },
      value: stringValue,
    };
    const spread: JsxAttributeFact = {
      kind: "spread",
      span: { start: 26, end: 36 },
      expressionSpan: { start: 30, end: 35 },
    };
    const child: JsxChildFact = {
      kind: "element",
      span: { start: 40, end: 49 },
      tagId: 2,
    };

    const invalidValue: JsxAttributeValueFact = {
      // @ts-expect-error analyzer does not expose evaluated numeric attribute values.
      kind: "number",
      value: "2",
      span: { start: 0, end: 1 },
    };
    // @ts-expect-error ordinary attributes require a name.
    const invalidAttribute: JsxAttributeFact = { kind: "attribute", span: { start: 0, end: 1 } };
    // @ts-expect-error element child facts link to a JSX tag id.
    const invalidChild: JsxChildFact = { kind: "element", span: { start: 0, end: 1 } };

    expect(attribute.value).toBe(stringValue);
    expect(expressionValue.expressionSpan).toEqual({ start: 21, end: 24 });
    expect(literalValue.kind).toBe("expression");
    expect(nestedLiteral.type).toBe("array");
    expect(literalChild.kind).toBe("expression");
    expect(invalidLiteral.type).toBe("object");
    expect(spread.kind).toBe("spread");
    expect(child.tagId).toBe(2);
    expect(invalidValue.kind).toBe("number");
    expect(invalidAttribute.kind).toBe("attribute");
    expect(invalidChild.kind).toBe("element");
  });

  test("transform target is a single string", () => {
    const valid: TransformInput = {
      filename: "src/input.ts",
      source: "export const value = 1;",
      target: "es2022",
    };

    expect(valid.target).toBe("es2022");

    const invalid: TransformInput = {
      filename: "src/input.ts",
      source: "export const value = 1;",
      // @ts-expect-error target arrays are intentionally not part of the public API.
      target: ["es2022", "es2020"],
    };

    expect(Array.isArray(invalid.target)).toBe(true);
  });

  test("createOxc has no options object", async () => {
    type CreateOxcArgs = Parameters<typeof createOxc>;

    const valid: CreateOxcArgs = [];
    expect(valid).toEqual([]);

    // @ts-expect-error createOxc does not accept placeholder options.
    const invalid: CreateOxcArgs = [{}];
    expect(invalid).toEqual([{}]);

    // @ts-expect-error exercise runtime behavior for untyped JavaScript callers.
    await expect(createOxc({})).rejects.toThrow("does not accept options");
  });
});
