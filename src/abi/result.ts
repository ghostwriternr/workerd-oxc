import type { OxcAbiExports } from "./instance.ts";
import { AbiMemoryScope } from "./memory.ts";

export function readJsonResult<T>(exports: OxcAbiExports, handle: number): T {
  if (handle === 0) throw new Error("Oxc ABI returned an empty result handle.");

  try {
    const ptr = exports.result_ptr(handle);
    const len = exports.result_len(handle);
    if (ptr === 0 || len === 0) throw new Error("Oxc ABI returned an empty result payload.");

    const scope = new AbiMemoryScope(exports);
    return JSON.parse(scope.readString(ptr, len)) as T;
  } finally {
    exports.free_result(handle);
  }
}
