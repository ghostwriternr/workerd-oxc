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
  target?: string | string[];
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

export interface CreateOxcOptions {}

export interface Oxc {
  parse(input: ParseInput): OxcResult<ParseOutput>;
  transform(input: TransformInput): OxcResult<TransformOutput>;
}
