import type {
  AnalyzeInput,
  AnalyzeOutput,
  Oxc,
  OxcResult,
  ParseInput,
  ParseOutput,
  TransformInput,
  TransformOutput,
} from "./types.ts";
import type { AnalyzeRuntime } from "./analyze.ts";
import type { ParserRuntime } from "./parser.ts";
import type { TransformRuntime } from "./transform.ts";

let defaultParserPromise: Promise<ParserRuntime> | undefined;
let defaultTransformPromise: Promise<TransformRuntime> | undefined;
let defaultAnalyzePromise: Promise<AnalyzeRuntime> | undefined;

export async function createOxc(): Promise<Oxc> {
  if (arguments.length > 0) {
    throw new TypeError("createOxc() does not accept options.");
  }

  let parserPromise: Promise<ParserRuntime> | undefined;
  let transformPromise: Promise<TransformRuntime> | undefined;
  let analyzePromise: Promise<AnalyzeRuntime> | undefined;

  const parser = () => (parserPromise ??= createParserRuntime());
  const transformer = () => (transformPromise ??= createTransformRuntime());
  const analyzer = () => (analyzePromise ??= createAnalyzeRuntime());

  return {
    async parse(input: ParseInput): Promise<OxcResult<ParseOutput>> {
      return (await parser()).parse(input);
    },
    async transform(input: TransformInput): Promise<OxcResult<TransformOutput>> {
      return (await transformer()).transform(input);
    },
    async experimentalAnalyze(input: AnalyzeInput): Promise<OxcResult<AnalyzeOutput>> {
      return (await analyzer()).analyze(input);
    },
  };
}

export async function parse(input: ParseInput): Promise<OxcResult<ParseOutput>> {
  return (await defaultParser()).parse(input);
}

export async function transform(input: TransformInput): Promise<OxcResult<TransformOutput>> {
  return (await defaultTransformer()).transform(input);
}

export async function experimentalAnalyze(input: AnalyzeInput): Promise<OxcResult<AnalyzeOutput>> {
  return (await defaultAnalyzer()).analyze(input);
}

function defaultParser(): Promise<ParserRuntime> {
  defaultParserPromise ??= createParserRuntime();
  return defaultParserPromise;
}

function defaultTransformer(): Promise<TransformRuntime> {
  defaultTransformPromise ??= createTransformRuntime();
  return defaultTransformPromise;
}

function defaultAnalyzer(): Promise<AnalyzeRuntime> {
  defaultAnalyzePromise ??= createAnalyzeRuntime();
  return defaultAnalyzePromise;
}

async function createParserRuntime(): Promise<ParserRuntime> {
  const mod = await import("./parser.ts");
  return mod.createParserRuntime();
}

async function createTransformRuntime(): Promise<TransformRuntime> {
  const mod = await import("./transform.ts");
  return mod.createTransformRuntime();
}

async function createAnalyzeRuntime(): Promise<AnalyzeRuntime> {
  const mod = await import("./analyze.ts");
  return mod.createAnalyzeRuntime();
}
