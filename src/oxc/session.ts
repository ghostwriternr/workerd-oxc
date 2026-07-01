import { transformEntrypointWithOxc } from "./transform";
import type {
  DynamicWorkerBuildSession,
  DynamicWorkerBuildSessionCompileResult,
  DynamicWorkerBuildSessionMetadata,
  DynamicWorkerModuleContent,
  DynamicWorkerVirtualModuleContent,
  ReactWorkerBuildInput,
  ReactWorkerBuildOutput
} from "../types";

export function experimentalCreateDynamicWorkerBuildSession(input: ReactWorkerBuildInput): DynamicWorkerBuildSession {
  return new OxcDynamicWorkerBuildSession(input);
}

class OxcDynamicWorkerBuildSession implements DynamicWorkerBuildSession {
  #input: ReactWorkerBuildInput;
  #revision = 0;
  #lastSuccessfulBuild: ReactWorkerBuildOutput | undefined;
  #lastSuccessfulRevision: number | undefined;
  #changedFiles = new Set<string>();
  #deletedFiles = new Set<string>();
  #changedVirtualModules = new Set<string>();
  #deletedVirtualModules = new Set<string>();
  #changedPackageFiles = new Set<string>();
  #deletedPackageFiles = new Set<string>();

  constructor(input: ReactWorkerBuildInput) {
    this.#input = cloneInput(input);
  }

  get revision(): number {
    return this.#revision;
  }

  async compile(): Promise<DynamicWorkerBuildSessionCompileResult> {
    const metadata = this.#metadata();
    const result = await transformEntrypointWithOxc(this.snapshotInput());

    if (result.ok) {
      this.#lastSuccessfulBuild = cloneBuildOutput(result);
      this.#lastSuccessfulRevision = this.#revision;
      metadata.lastSuccessfulRevision = this.#lastSuccessfulRevision;
    }

    this.#clearDirtySets();

    return {
      ...result,
      session: metadata
    };
  }

  updateFile(path: string, source: string): void {
    const normalized = normalizeSessionPath(path);
    if (this.#input.files[normalized] === source) return;
    this.#input.files[normalized] = source;
    this.#recordChange(this.#changedFiles, this.#deletedFiles, normalized);
  }

  deleteFile(path: string): void {
    const normalized = normalizeSessionPath(path);
    if (this.#input.files[normalized] === undefined) return;
    delete this.#input.files[normalized];
    this.#recordDelete(this.#changedFiles, this.#deletedFiles, normalized);
  }

  setVirtualModule(path: string, content: DynamicWorkerVirtualModuleContent): void {
    const normalized = normalizeSessionPath(path);
    this.#input.virtualModules ??= {};
    if (virtualModuleContentEquals(this.#input.virtualModules[normalized], content)) return;
    this.#input.virtualModules[normalized] = cloneVirtualModuleContent(content);
    this.#recordChange(this.#changedVirtualModules, this.#deletedVirtualModules, normalized);
  }

  deleteVirtualModule(path: string): void {
    const normalized = normalizeSessionPath(path);
    if (this.#input.virtualModules?.[normalized] === undefined) return;
    delete this.#input.virtualModules[normalized];
    this.#recordDelete(this.#changedVirtualModules, this.#deletedVirtualModules, normalized);
  }

  setPackageFile(path: string, source: string): void {
    const normalized = normalizeSessionPath(path);
    this.#input.packageFiles ??= {};
    if (this.#input.packageFiles[normalized] === source) return;
    this.#input.packageFiles[normalized] = source;
    this.#recordChange(this.#changedPackageFiles, this.#deletedPackageFiles, normalized);
  }

  deletePackageFile(path: string): void {
    const normalized = normalizeSessionPath(path);
    if (this.#input.packageFiles?.[normalized] === undefined) return;
    delete this.#input.packageFiles[normalized];
    this.#recordDelete(this.#changedPackageFiles, this.#deletedPackageFiles, normalized);
  }

  reset(input: ReactWorkerBuildInput): void {
    this.#input = cloneInput(input);
    this.#revision += 1;
    this.#clearDirtySets();
  }

  snapshotInput(): ReactWorkerBuildInput {
    return cloneInput(this.#input);
  }

  getLastSuccessfulBuild(): ReactWorkerBuildOutput | undefined {
    return this.#lastSuccessfulBuild ? cloneBuildOutput(this.#lastSuccessfulBuild) : undefined;
  }

  #recordChange(changed: Set<string>, deleted: Set<string>, path: string): void {
    changed.add(path);
    deleted.delete(path);
    this.#revision += 1;
  }

  #recordDelete(changed: Set<string>, deleted: Set<string>, path: string): void {
    changed.delete(path);
    deleted.add(path);
    this.#revision += 1;
  }

  #metadata(): DynamicWorkerBuildSessionMetadata {
    return {
      revision: this.#revision,
      changedFiles: sorted(this.#changedFiles),
      deletedFiles: sorted(this.#deletedFiles),
      changedVirtualModules: sorted(this.#changedVirtualModules),
      deletedVirtualModules: sorted(this.#deletedVirtualModules),
      changedPackageFiles: sorted(this.#changedPackageFiles),
      deletedPackageFiles: sorted(this.#deletedPackageFiles),
      reusedLastGoodBuild: false,
      lastSuccessfulRevision: this.#lastSuccessfulRevision
    };
  }

  #clearDirtySets(): void {
    this.#changedFiles.clear();
    this.#deletedFiles.clear();
    this.#changedVirtualModules.clear();
    this.#deletedVirtualModules.clear();
    this.#changedPackageFiles.clear();
    this.#deletedPackageFiles.clear();
  }
}

function cloneInput(input: ReactWorkerBuildInput): ReactWorkerBuildInput {
  return {
    ...input,
    entrypoint: normalizeSessionPath(input.entrypoint),
    files: Object.fromEntries(Object.entries(input.files).map(([path, source]) => [normalizeSessionPath(path), source])),
    virtualModules: input.virtualModules
      ? Object.fromEntries(
          Object.entries(input.virtualModules).map(([path, content]) => [
            normalizeSessionPath(path),
            cloneVirtualModuleContent(content)
          ])
        )
      : undefined,
    packageFiles: input.packageFiles
      ? Object.fromEntries(Object.entries(input.packageFiles).map(([path, source]) => [normalizeSessionPath(path), source]))
      : undefined,
    jsx: input.jsx ? { ...input.jsx } : undefined
  };
}

function cloneBuildOutput(output: ReactWorkerBuildOutput): ReactWorkerBuildOutput {
  return {
    ...output,
    modules: output.modules
      ? Object.fromEntries(Object.entries(output.modules).map(([path, content]) => [path, cloneModuleContent(content)]))
      : undefined,
    diagnostics: output.diagnostics.map((item) => ({ ...item })),
    evidence: output.evidence.map((item) => ({ ...item })),
    toolchain: { ...output.toolchain }
  };
}

function cloneModuleContent(content: DynamicWorkerModuleContent): DynamicWorkerModuleContent {
  if (typeof content === "string") return content;
  if ("js" in content) return { js: content.js };
  if ("cjs" in content) return { cjs: content.cjs };
  if ("json" in content) return { json: cloneJsonValue(content.json) };
  if ("text" in content) return { text: content.text };
  if ("data" in content) return { data: cloneArrayBuffer(content.data) };
  return { wasm: cloneArrayBuffer(content.wasm) };
}

function cloneVirtualModuleContent(content: DynamicWorkerVirtualModuleContent): DynamicWorkerVirtualModuleContent {
  return cloneModuleContent(content) as DynamicWorkerVirtualModuleContent;
}

function virtualModuleContentEquals(
  left: DynamicWorkerVirtualModuleContent | undefined,
  right: DynamicWorkerVirtualModuleContent,
): boolean {
  if (left === undefined) return false;
  if (typeof left === "string" || typeof right === "string") return left === right;
  if ("js" in left || "js" in right) return "js" in left && "js" in right && left.js === right.js;
  if ("json" in left || "json" in right) return "json" in left && "json" in right && JSON.stringify(left.json) === JSON.stringify(right.json);
  if ("text" in left || "text" in right) return "text" in left && "text" in right && left.text === right.text;
  if ("data" in left || "data" in right) return "data" in left && "data" in right && arrayBuffersEqual(left.data, right.data);
  return "wasm" in left && "wasm" in right && arrayBuffersEqual(left.wasm, right.wasm);
}

function cloneJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function cloneArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

function arrayBuffersEqual(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

function normalizeSessionPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return `../${path}`;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function sorted(values: Set<string>): string[] {
  return Array.from(values).sort();
}
