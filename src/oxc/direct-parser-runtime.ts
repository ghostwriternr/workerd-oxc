import directParserModule from "../wasm/oxc-direct-parser.wasm";

const ABI_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface DirectParseDiagnostic {
  severity?: unknown;
  message?: unknown;
  file?: unknown;
  start?: unknown;
  end?: unknown;
}

export interface DirectParsePayload {
  abiVersion?: unknown;
  kind?: unknown;
  ok?: unknown;
  rawProgramLength?: unknown;
  payload?: unknown;
  diagnostics?: unknown;
}

interface DirectParserExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  abi_version: () => number;
  alloc: (len: number) => number;
  free: (ptr: number, len: number) => void;
  parse: (
    filenamePtr: number,
    filenameLen: number,
    sourcePtr: number,
    sourceLen: number,
    optionsPtr: number,
    optionsLen: number,
  ) => number;
  result_ptr: (handle: number) => number;
  result_len: (handle: number) => number;
  free_result: (handle: number) => void;
}

let parserPromise: Promise<DirectParserExports> | undefined;

export async function getDirectParser(): Promise<DirectParserExports> {
  parserPromise ??= instantiateDirectParser();
  return parserPromise;
}

export async function parseWithDirectParser(filename: string, source: string, options: unknown): Promise<DirectParsePayload> {
  const parser = await getDirectParser();
  const allocations: Array<{ ptr: number; len: number }> = [];
  let handle = 0;

  try {
    const filenameBytes = trackAllocation(allocations, writeBytes(parser, filename));
    const sourceBytes = trackAllocation(allocations, writeBytes(parser, source));
    const optionsJson = JSON.stringify(options ?? {});
    if (optionsJson === undefined) throw new Error("Oxc direct parser options must be JSON-serializable.");
    const optionsBytes = trackAllocation(allocations, writeBytes(parser, optionsJson));

    handle = parser.parse(
      filenameBytes.ptr,
      filenameBytes.len,
      sourceBytes.ptr,
      sourceBytes.len,
      optionsBytes.ptr,
      optionsBytes.len,
    );

    const resultPtr = parser.result_ptr(handle);
    const resultLen = parser.result_len(handle);
    if (resultPtr === 0 || resultLen === 0) {
      throw new Error("Oxc direct parser returned an empty result handle.");
    }

    const resultBytes = new Uint8Array(parser.memory.buffer, resultPtr, resultLen);
    return JSON.parse(decoder.decode(resultBytes)) as DirectParsePayload;
  } catch (error) {
    // A WebAssembly trap can leave an instance in an unknown state. Recreate the
    // direct parser on the next call rather than reusing a potentially poisoned
    // instance. This also covers allocation/free-time ABI failures.
    parserPromise = undefined;
    throw error;
  } finally {
    if (handle !== 0) parser.free_result(handle);
    for (let index = allocations.length - 1; index >= 0; index -= 1) {
      freeBytes(parser, allocations[index]!);
    }
  }
}

async function instantiateDirectParser(): Promise<DirectParserExports> {
  const instance = await WebAssembly.instantiate(directParserModule, {});
  const exports = instance.exports as DirectParserExports;
  if (exports.abi_version() !== ABI_VERSION) {
    throw new Error(`Unsupported Oxc direct parser ABI version ${exports.abi_version()}.`);
  }
  return exports;
}

function trackAllocation(
  allocations: Array<{ ptr: number; len: number }>,
  allocation: { ptr: number; len: number },
): { ptr: number; len: number } {
  if (allocation.ptr !== 0 && allocation.len > 0) allocations.push(allocation);
  return allocation;
}

function writeBytes(parser: DirectParserExports, value: string): { ptr: number; len: number } {
  const bytes = encoder.encode(value);
  if (bytes.length === 0) return { ptr: 0, len: 0 };

  const ptr = parser.alloc(bytes.length);
  if (ptr === 0) throw new Error(`Oxc direct parser could not allocate ${bytes.length} bytes.`);
  new Uint8Array(parser.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

function freeBytes(parser: DirectParserExports, allocation: { ptr: number; len: number }): void {
  if (allocation.ptr !== 0 && allocation.len > 0) parser.free(allocation.ptr, allocation.len);
}
