import analyzeModule from "./wasm/analyze.wasm";

import { parseAnalyzePayload } from "./analyze-payload.ts";
import { createAbiOperationRuntime, isRuntimeError } from "./abi/operation.ts";
import { stringifyJsonOptions } from "./source.ts";
import type { AnalyzeInput, AnalyzeOutput, OxcResult } from "./types.ts";
import type { AnalyzeAbiExports } from "./abi/instance.ts";

export interface AnalyzeRuntime {
  analyze(input: AnalyzeInput): OxcResult<AnalyzeOutput>;
}

export function createAnalyzeRuntime(): AnalyzeRuntime {
  const runtime = createAbiOperationRuntime<AnalyzeAbiExports>({
    module: analyzeModule,
    label: "Oxc analyzer",
  });

  return {
    analyze(input: AnalyzeInput): OxcResult<AnalyzeOutput> {
      const payload = runtime.call<unknown>({
        filename: input.filename,
        source: input.source,
        optionsJson: stringifyJsonOptions(
          { lang: input.lang, sourceType: input.sourceType },
          "Oxc analyzer",
        ),
        invoke: (exports, args) => exports.analyze(...args),
      });
      if (isRuntimeError(payload)) return { ok: false, diagnostics: [payload.runtimeError] };
      return parseAnalyzePayload(input, payload);
    },
  };
}
