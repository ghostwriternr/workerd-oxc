import type {
  DynamicWorkerModuleContent,
  DynamicWorkerModules,
  ReactWorkerBuildOutput,
} from "./types";

export type HashableDynamicWorkerBuild = DynamicWorkerModules | ReactWorkerBuildOutput;

export function hashDynamicWorkerBuild(build: HashableDynamicWorkerBuild): string {
  const modules = extractModules(build);
  const hasher = new StableHasher();

  hasher.writeString("workers-tsx-toolchain-spike:dynamic-worker-build:v1");
  hasher.writeString("main");
  hasher.writeString(modules.mainModule);
  hasher.writeString("modules");

  for (const key of Object.keys(modules.modules).sort()) {
    hasher.writeString("module");
    hasher.writeString(key);
    writeModuleContent(hasher, modules.modules[key]);
  }

  return hasher.digest();
}

export function dynamicWorkerBuildId(prefix: string, build: HashableDynamicWorkerBuild): string {
  const normalizedPrefix = normalizeIdPrefix(prefix);
  return `${normalizedPrefix}:${hashDynamicWorkerBuild(build)}`;
}

function extractModules(build: HashableDynamicWorkerBuild): DynamicWorkerModules {
  if ("ok" in build && build.ok !== true) {
    throw new TypeError("Cannot hash a failed Dynamic Worker build.");
  }

  if (typeof build.mainModule !== "string" || build.mainModule.length === 0 || build.modules === undefined) {
    throw new TypeError("Dynamic Worker build hash requires mainModule and modules.");
  }

  if (build.modules[build.mainModule] === undefined) {
    throw new TypeError(`Dynamic Worker build mainModule is not present in modules: ${build.mainModule}`);
  }

  return { mainModule: build.mainModule, modules: build.modules };
}

function normalizeIdPrefix(prefix: string): string {
  const normalized = prefix.trim();
  if (normalized.length === 0) {
    throw new TypeError("Dynamic Worker build ID prefix must not be empty.");
  }
  if (normalized.includes(":")) {
    throw new TypeError("Dynamic Worker build ID prefix must not contain ':'.");
  }
  if (/\s/.test(normalized)) {
    throw new TypeError("Dynamic Worker build ID prefix must not contain whitespace.");
  }
  return normalized;
}

function writeModuleContent(hasher: StableHasher, content: DynamicWorkerModuleContent): void {
  if (typeof content === "string") {
    hasher.writeString("string");
    hasher.writeString(content);
    return;
  }

  const keys = Object.keys(content);
  if (keys.length !== 1) {
    throw new TypeError(`Dynamic Worker module content must contain exactly one type key; got ${keys.length}.`);
  }

  const key = keys[0];
  const record = content as Record<string, unknown>;
  switch (key) {
    case "js":
    case "cjs":
    case "text": {
      if (typeof record[key] !== "string") {
        throw new TypeError(`Dynamic Worker module key '${key}' must contain a string.`);
      }
      hasher.writeString(key);
      hasher.writeString(record[key]);
      return;
    }
    case "json":
      hasher.writeString("json");
      writeCanonicalJson(hasher, record.json);
      return;
    case "data":
    case "wasm": {
      if (!(record[key] instanceof ArrayBuffer)) {
        throw new TypeError(`Dynamic Worker module key '${key}' must contain an ArrayBuffer.`);
      }
      hasher.writeString(key);
      hasher.writeBytes(new Uint8Array(record[key]));
      return;
    }
    default:
      throw new TypeError(`Unsupported Dynamic Worker module content key: ${key}.`);
  }
}

function writeCanonicalJson(hasher: StableHasher, value: unknown): void {
  if (value === null) {
    hasher.writeString("null");
    return;
  }

  const type = typeof value;
  if (type === "string" || type === "boolean") {
    hasher.writeString(type);
    hasher.writeString(JSON.stringify(value));
    return;
  }

  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON module numbers must be finite for Dynamic Worker build hashing.");
    }
    hasher.writeString(type);
    hasher.writeString(JSON.stringify(value));
    return;
  }

  if (Array.isArray(value)) {
    hasher.writeString("array");
    hasher.writeString(String(value.length));
    for (const item of value) writeCanonicalJson(hasher, item);
    return;
  }

  if (type === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError("JSON module objects must be plain objects for Dynamic Worker build hashing.");
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    hasher.writeString("object");
    hasher.writeString(String(keys.length));
    for (const key of keys) {
      if (record[key] === undefined) {
        throw new TypeError(`JSON module property '${key}' is undefined and cannot be hashed deterministically.`);
      }
      hasher.writeString(key);
      writeCanonicalJson(hasher, record[key]);
    }
    return;
  }

  throw new TypeError(`Unsupported JSON module value type for Dynamic Worker build hash: ${type}`);
}

class StableHasher {
  #left = 0x811c9dc5;
  #right = 0x811c9dc5 ^ 0x9e3779b9;

  writeString(value: string): void {
    this.writeBytes(new TextEncoder().encode(value));
    this.writeByte(0);
  }

  writeBytes(bytes: Uint8Array): void {
    this.writeStringLength(bytes.byteLength);
    for (const byte of bytes) this.writeByte(byte);
  }

  digest(): string {
    return `${toHex32(this.#left)}${toHex32(this.#right)}`;
  }

  private writeStringLength(length: number): void {
    this.writeByte(length & 0xff);
    this.writeByte((length >>> 8) & 0xff);
    this.writeByte((length >>> 16) & 0xff);
    this.writeByte((length >>> 24) & 0xff);
  }

  private writeByte(byte: number): void {
    this.#left ^= byte;
    this.#left = Math.imul(this.#left, 0x01000193);
    this.#right ^= (byte + 0x9e3779b9 + ((this.#right << 6) >>> 0) + (this.#right >>> 2)) >>> 0;
    this.#right = Math.imul(this.#right, 0x85ebca6b);
  }
}

function toHex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}
