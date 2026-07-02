const ABI_VERSION = 1;

export interface OxcAbiExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  abi_version: () => number;
  alloc: (len: number) => number;
  free: (ptr: number, len: number) => void;
  result_ptr: (handle: number) => number;
  result_len: (handle: number) => number;
  free_result: (handle: number) => void;
}

export interface ParserAbiExports extends OxcAbiExports {
  parse: (
    filenamePtr: number,
    filenameLen: number,
    sourcePtr: number,
    sourceLen: number,
    optionsPtr: number,
    optionsLen: number,
  ) => number;
}

export interface TransformAbiExports extends OxcAbiExports {
  transform: (
    filenamePtr: number,
    filenameLen: number,
    sourcePtr: number,
    sourceLen: number,
    optionsPtr: number,
    optionsLen: number,
  ) => number;
}

export function instantiateAbiModule<T extends OxcAbiExports>(module: WebAssembly.Module, label: string): T {
  const instance = new WebAssembly.Instance(module, {});
  const exports = instance.exports as T;

  const version = exports.abi_version?.();
  if (version !== ABI_VERSION) {
    throw new Error(`Unsupported ${label} ABI version ${String(version)}.`);
  }

  if (!(exports.memory instanceof WebAssembly.Memory)) {
    throw new Error(`${label} ABI did not export WebAssembly.Memory.`);
  }

  return exports;
}
