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
  phase: "parse" | "transform" | "runtime";
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
  parse(input: ParseInput): OxcResult<ParseOutput>;
  transform(input: TransformInput): OxcResult<TransformOutput>;
  experimentalAnalyze(input: AnalyzeInput): OxcResult<AnalyzeOutput>;
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

export interface ImportFact {
  source: string;
  local: string;
  imported: string | "default" | "namespace";
  kind: "value" | "type";
  span: OxcSourceSpan;
  sourceSpan: OxcSourceSpan;
}

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

export interface ExportFact {
  kind: ExportKind;
  local?: string;
  exported?: string;
  source?: string;
  exportKind?: ExportValueKind;
  declarationKind?: ExportDeclarationKind;
  span: OxcSourceSpan;
}

export interface JsxTagFact {
  name: string;
  kind: "identifier" | "member" | "namespaced";
  bindingId?: number;
  span: OxcSourceSpan;
}
