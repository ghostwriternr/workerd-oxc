import { runtimeDiagnostic } from "../diagnostics.ts";
import type { OxcDiagnostic } from "../types.ts";
import { instantiateAbiModule, type OxcAbiExports } from "./instance.ts";
import { AbiMemoryScope } from "./memory.ts";
import { readJsonResult } from "./result.ts";

export interface AbiCallInput<TExports extends OxcAbiExports> {
  filename: string;
  source: string;
  optionsJson: string;
  invoke: (exports: TExports, args: [number, number, number, number, number, number]) => number;
}

export type AbiCallResult<TPayload> = TPayload | { runtimeError: OxcDiagnostic };

export interface AbiOperationRuntime<TExports extends OxcAbiExports> {
  call<TPayload>(input: AbiCallInput<TExports>): AbiCallResult<TPayload>;
}

export function createAbiOperationRuntime<TExports extends OxcAbiExports>(input: {
  module: WebAssembly.Module;
  label: string;
}): AbiOperationRuntime<TExports> {
  let exports = instantiateAbiModule<TExports>(input.module, input.label);

  return {
    call<TPayload>(callInput: AbiCallInput<TExports>): AbiCallResult<TPayload> {
      try {
        const scope = new AbiMemoryScope(exports);
        try {
          const filename = scope.writeString(callInput.filename);
          const source = scope.writeString(callInput.source);
          const options = scope.writeString(callInput.optionsJson);
          const handle = callInput.invoke(exports, [
            filename.ptr,
            filename.len,
            source.ptr,
            source.len,
            options.ptr,
            options.len,
          ]);
          return readJsonResult<TPayload>(exports, handle);
        } finally {
          scope.dispose();
        }
      } catch (error) {
        try {
          exports = instantiateAbiModule<TExports>(input.module, input.label);
        } catch {
          // Preserve the original error in this call's diagnostic.
        }
        return {
          runtimeError: runtimeDiagnostic("runtime", `${input.label} runtime failed.`, error),
        };
      }
    },
  };
}

export function isRuntimeError<TPayload>(
  result: AbiCallResult<TPayload>,
): result is { runtimeError: OxcDiagnostic } {
  return typeof result === "object" && result !== null && "runtimeError" in result;
}
