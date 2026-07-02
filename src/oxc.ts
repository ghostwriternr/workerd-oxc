import type { CreateOxcOptions, Oxc, OxcResult, ParseInput, ParseOutput, TransformInput, TransformOutput } from "./types.ts";

let defaultOxcPromise: Promise<Oxc> | undefined;

export async function createOxc(_options: CreateOxcOptions = {}): Promise<Oxc> {
  const [{ createParserRuntime }, { createTransformRuntime }] = await Promise.all([
    import("./parser.ts"),
    import("./transform.ts"),
  ]);

  const parser = createParserRuntime();
  const transformer = createTransformRuntime();

  return {
    parse(input: ParseInput): OxcResult<ParseOutput> {
      return parser.parse(input);
    },
    transform(input: TransformInput): OxcResult<TransformOutput> {
      return transformer.transform(input);
    },
  };
}

export async function parse(input: ParseInput): Promise<OxcResult<ParseOutput>> {
  const oxc = await defaultOxc();
  return oxc.parse(input);
}

export async function transform(input: TransformInput): Promise<OxcResult<TransformOutput>> {
  const oxc = await defaultOxc();
  return oxc.transform(input);
}

function defaultOxc(): Promise<Oxc> {
  defaultOxcPromise ??= createOxc();
  return defaultOxcPromise;
}
