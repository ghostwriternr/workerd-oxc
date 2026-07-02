import type { OxcAbiExports } from "./instance.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface Allocation {
  ptr: number;
  len: number;
}

export class AbiMemoryScope {
  readonly #exports: OxcAbiExports;
  readonly #allocations: Allocation[] = [];

  constructor(exports: OxcAbiExports) {
    this.#exports = exports;
  }

  writeString(value: string): Allocation {
    const bytes = encoder.encode(value);
    if (bytes.length === 0) return { ptr: 0, len: 0 };

    const ptr = this.#exports.alloc(bytes.length);
    if (ptr === 0) throw new Error(`Oxc ABI could not allocate ${bytes.length} bytes.`);

    new Uint8Array(this.#exports.memory.buffer, ptr, bytes.length).set(bytes);
    const allocation = { ptr, len: bytes.length };
    this.#allocations.push(allocation);
    return allocation;
  }

  readString(ptr: number, len: number): string {
    if (ptr === 0 || len === 0) return "";
    return decoder.decode(new Uint8Array(this.#exports.memory.buffer, ptr, len));
  }

  dispose(): void {
    for (let index = this.#allocations.length - 1; index >= 0; index -= 1) {
      const allocation = this.#allocations[index]!;
      this.#exports.free(allocation.ptr, allocation.len);
    }
    this.#allocations.length = 0;
  }
}
