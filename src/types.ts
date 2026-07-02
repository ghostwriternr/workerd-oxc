export type OxcLanguage = "js" | "jsx" | "ts" | "tsx";

export type OxcSourceType = "module" | "script";

export interface OxcJsxOptions {
  runtime?: "automatic" | "classic";
  importSource?: string;
  development?: boolean;
}

export interface ParseInput {
  filename: string;
  source: string;
  lang?: OxcLanguage;
  sourceType?: OxcSourceType;
  astType?: "js" | "ts";
  range?: boolean;
  preserveParens?: boolean;
}

export interface TransformInput {
  filename: string;
  source: string;
  lang?: OxcLanguage;
  sourceType?: OxcSourceType;
  target?: string;
  sourcemap?: boolean;
  jsx?: "preserve" | OxcJsxOptions;
}

export type OxcResult<T> =
  | { ok: true; value: T; diagnostics: OxcDiagnostic[] }
  | { ok: false; diagnostics: OxcDiagnostic[] };

export interface ParseOutput {
  ast: OxcProgramAst;
  rawProgramLength: number;
}

export interface TransformOutput {
  code: string;
  map?: SourceMapV3;
}

export type OxcProgramAst = {
  type: "Program";
  sourceType?: string;
  body: unknown[];
  [key: string]: unknown;
};

export interface OxcDiagnostic {
  phase: "parse" | "transform" | "analyze" | "runtime";
  severity: "error" | "warning";
  message: string;
  filename?: string;
  location?: OxcSourceLocation;
  span?: OxcSourceSpan;
  cause?: string;
}

export interface OxcSourceLocation {
  line: number;
  column: number;
}

export interface OxcSourceSpan {
  start: number;
  end: number;
}

export interface SourceMapV3 {
  version: 3;
  file?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names: string[];
  mappings: string;
  sourceRoot?: string;
}

export interface Oxc {
  parse(input: ParseInput): Promise<OxcResult<ParseOutput>>;
  transform(input: TransformInput): Promise<OxcResult<TransformOutput>>;
  experimentalAnalyze(input: AnalyzeInput): Promise<OxcResult<AnalyzeOutput>>;
}

export interface AnalyzeInput {
  filename: string;
  source: string;
  lang?: OxcLanguage;
  sourceType?: OxcSourceType;
}

export interface AnalyzeOutput {
  scopes: ScopeFact[];
  bindings: BindingFact[];
  references: ReferenceFact[];
  unresolved: ReferenceFact[];
  imports: ImportFact[];
  exports: ExportFact[];
  jsxTags: JsxTagFact[];
}

export interface ScopeFact {
  id: number;
  parentId?: number;
  kind: string;
  span?: OxcSourceSpan;
}

export type BindingKind =
  | "import"
  | "function"
  | "class"
  | "const"
  | "let"
  | "var"
  | "param"
  | "type"
  | "interface"
  | "enum"
  | "enum-member"
  | "unknown";

export interface BindingFact {
  id: number;
  name: string;
  kind: BindingKind;
  flags: string[];
  scopeId: number;
  span: OxcSourceSpan;
  references: number[];
  mutated?: boolean;
  unused?: boolean;
}

export interface ReferenceFact {
  id: number;
  name: string;
  kind: "identifier" | "type";
  flags: string[];
  scopeId: number;
  bindingId?: number;
  span: OxcSourceSpan;
}

export type ImportSpecifierKind = "named" | "default" | "namespace";

export type ImportFact =
  | {
      specifierKind: "named";
      source: string;
      local: string;
      imported: string;
      kind: "value" | "type";
      span: OxcSourceSpan;
      sourceSpan: OxcSourceSpan;
    }
  | {
      specifierKind: "default" | "namespace";
      source: string;
      local: string;
      kind: "value" | "type";
      span: OxcSourceSpan;
      sourceSpan: OxcSourceSpan;
    };

export type ExportKind = "named" | "default" | "all";

export type ExportValueKind = "value" | "type";

export type ExportDeclarationKind =
  | "function"
  | "class"
  | "const"
  | "let"
  | "var"
  | "type"
  | "interface"
  | "enum";

export type ExportFact =
  | {
      kind: "named";
      local: string;
      exported: string;
      source?: string;
      exportKind?: ExportValueKind;
      declarationKind?: ExportDeclarationKind;
      span: OxcSourceSpan;
    }
  | {
      kind: "default";
      exported: "default";
      local?: string;
      source?: never;
      exportKind?: ExportValueKind;
      declarationKind?: ExportDeclarationKind;
      span: OxcSourceSpan;
    }
  | {
      kind: "all";
      local?: never;
      exported?: string;
      source: string;
      exportKind?: ExportValueKind;
      declarationKind?: never;
      span: OxcSourceSpan;
    };

export interface JsxTagFact {
  id: number;
  parentId?: number;
  name: string;
  kind: "identifier" | "member" | "namespaced";
  bindingId?: number;
  span: OxcSourceSpan;
  nameSpan: OxcSourceSpan;
  elementSpan: OxcSourceSpan;
  closingSpan?: OxcSourceSpan;
  closingNameSpan?: OxcSourceSpan;
  selfClosing: boolean;
  attributes: JsxAttributeFact[];
  children: JsxChildFact[];
}

export type JsxAttributeFact =
  | {
      kind: "attribute";
      name: string;
      nameSpan: OxcSourceSpan;
      span: OxcSourceSpan;
      value?: JsxAttributeValueFact;
    }
  | {
      kind: "spread";
      span: OxcSourceSpan;
      expressionSpan: OxcSourceSpan;
    };

export type JsxAttributeValueFact =
  | { kind: "string"; value: string; span: OxcSourceSpan }
  | { kind: "expression"; span: OxcSourceSpan; expressionSpan?: OxcSourceSpan }
  | { kind: "element"; span: OxcSourceSpan; tagId?: number }
  | { kind: "fragment"; span: OxcSourceSpan };

export type JsxChildFact =
  | { kind: "text"; span: OxcSourceSpan; raw: string; value?: string }
  | { kind: "element"; span: OxcSourceSpan; tagId: number }
  | { kind: "fragment"; span: OxcSourceSpan; children: JsxChildFact[] }
  | { kind: "expression"; span: OxcSourceSpan; expressionSpan?: OxcSourceSpan }
  | { kind: "spread"; span: OxcSourceSpan; expressionSpan: OxcSourceSpan };
