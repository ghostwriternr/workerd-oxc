import { diagnostic, evidence, isProbablyWorkerd } from "../diagnostics";
import { buildLocalModuleGraph } from "./module-graph";
import { buildPackageModuleGraph } from "./package-resolver";
import {
  getOxcParserForRuntime,
  getOxcTransformerForRuntime,
  normalizePackageFilesForOxc,
  normalizeVirtualModulesForOxc,
  processModuleSpecifiersWithOxc,
  scanModuleSpecifiersWithOxc,
  transformOptionsForOxc,
  type NormalizedVirtualModule
} from "./transform";
import type {
  DynamicWorkerBuildSession,
  DynamicWorkerBuildSessionCacheMetadata,
  DynamicWorkerBuildSessionCompileResult,
  DynamicWorkerBuildSessionMetadata,
  DynamicWorkerModuleContent,
  DynamicWorkerVirtualModuleContent,
  ReactWorkerBuildInput,
  ReactWorkerBuildOutput,
  ToolchainDiagnostic,
  ToolchainEvidence
} from "../types";

interface LocalModuleCacheEntry {
  cacheKey: string;
  outputPath: string;
  content: DynamicWorkerModuleContent;
  packageImports: string[];
}

interface VirtualModuleCacheEntry {
  cacheKey: string;
  outputPath: string;
  content: DynamicWorkerModuleContent;
  packageImports: string[];
}

interface PackageGraphCacheEntry {
  cacheKey: string;
  modules: Record<string, DynamicWorkerModuleContent>;
}

interface CompileCacheState {
  localModules: Map<string, LocalModuleCacheEntry>;
  virtualModules: Map<string, VirtualModuleCacheEntry>;
  packageGraph?: PackageGraphCacheEntry;
  outputPaths: Set<string>;
}

export function experimentalCreateDynamicWorkerBuildSession(input: ReactWorkerBuildInput): DynamicWorkerBuildSession {
  return new OxcDynamicWorkerBuildSession(input);
}

class OxcDynamicWorkerBuildSession implements DynamicWorkerBuildSession {
  #input: ReactWorkerBuildInput;
  #revision = 0;
  #lastSuccessfulBuild: ReactWorkerBuildOutput | undefined;
  #lastSuccessfulRevision: number | undefined;
  #cache: CompileCacheState = emptyCacheState();
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
    const compiled = await compileWithCache(this.snapshotInput(), this.#cache);
    metadata.cache = compiled.cacheMetadata;

    if (compiled.output.ok) {
      this.#cache = compiled.cache;
      this.#lastSuccessfulBuild = cloneBuildOutput(compiled.output);
      this.#lastSuccessfulRevision = this.#revision;
      metadata.lastSuccessfulRevision = this.#lastSuccessfulRevision;
    }

    this.#clearDirtySets();

    return {
      ...compiled.output,
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
    this.#cache = emptyCacheState();
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

async function compileWithCache(input: ReactWorkerBuildInput, previousCache: CompileCacheState): Promise<{
  output: ReactWorkerBuildOutput;
  cache: CompileCacheState;
  cacheMetadata: DynamicWorkerBuildSessionCacheMetadata;
}> {
  const diagnostics: ToolchainDiagnostic[] = [];
  const events: ToolchainEvidence[] = [];
  const transformedModules = new Set<string>();
  const reusedModules = new Set<string>();
  let packageGraphRebuilt = false;

  const parserImportStart = performance.now();
  let parser;
  try {
    parser = await getOxcParserForRuntime();
    events.push(evidence("oxc-parser", "import", true, parserImportStart, isProbablyWorkerd() ? "reused oxc-parser wasm through @alexbruf/wasmkernel" : "imported browser/WASI parser entry"));
  } catch (error) {
    events.push(evidence("oxc-parser", "import", false, parserImportStart));
    diagnostics.push(diagnostic("oxc-parser", "import-failed", "Could not initialize Oxc parser for session graph discovery.", error));
    return failedCompile(diagnostics, events, previousCache, transformedModules, reusedModules, packageGraphRebuilt);
  }

  const transformerImportStart = performance.now();
  let transformer;
  try {
    transformer = await getOxcTransformerForRuntime();
    events.push(evidence("oxc-transform", "import", true, transformerImportStart, isProbablyWorkerd() ? "reused oxc-transform wasm through @alexbruf/wasmkernel" : "imported browser/WASI transform entry"));
  } catch (error) {
    events.push(evidence("oxc-transform", "import", false, transformerImportStart));
    diagnostics.push(diagnostic("oxc-transform", "import-failed", "Could not initialize Oxc transform for session compile.", error));
    return failedCompile(diagnostics, events, previousCache, transformedModules, reusedModules, packageGraphRebuilt);
  }

  const normalizedVirtualModules = normalizeVirtualModulesForOxc(input.virtualModules ?? {});
  if (normalizedVirtualModules.diagnostics.length > 0) {
    diagnostics.push(...normalizedVirtualModules.diagnostics);
    return failedCompile(diagnostics, events, previousCache, transformedModules, reusedModules, packageGraphRebuilt);
  }
  const virtualModules = normalizedVirtualModules.modules;
  const normalizedPackageFiles = input.packageFiles ? normalizePackageFilesForOxc(input.packageFiles) : undefined;
  const graphInput = normalizedPackageFiles ? { ...input, packageFiles: normalizedPackageFiles } : input;

  const graphStart = performance.now();
  const graph = await buildLocalModuleGraph(graphInput, (filename, source) => scanModuleSpecifiersWithOxc(parser, filename, source));
  events.push(evidence("oxc-transform", "bundle", graph.ok, graphStart, graph.ok ? `${graph.modules?.length ?? 0} local modules resolved from Oxc parser metadata` : "local module graph resolution failed"));
  if (!graph.ok || graph.mainModule === undefined || graph.modules === undefined) {
    diagnostics.push(...graph.diagnostics);
    return failedCompile(diagnostics, events, previousCache, transformedModules, reusedModules, packageGraphRebuilt);
  }

  const nextCache: CompileCacheState = {
    localModules: new Map(),
    virtualModules: new Map(),
    packageGraph: previousCache.packageGraph,
    outputPaths: new Set()
  };
  const modules: Record<string, DynamicWorkerModuleContent> = {};
  const packageImports = new Set(graph.packageImports);
  const virtualResolutionKey = JSON.stringify(Object.entries(virtualModules).map(([name, module]) => [name, module.outputPath]).sort());
  const packageResolutionKey = JSON.stringify(Object.entries(normalizedPackageFiles ?? {}).filter(([path]) => path.endsWith("/package.json")).sort());
  const jsxKey = JSON.stringify(input.jsx ?? {});
  const localContextKey = JSON.stringify({ jsxKey, virtualResolutionKey, packageResolutionKey });
  const transformStart = performance.now();

  try {
    for (const module of graph.modules) {
      const cacheKey = JSON.stringify({ source: module.source, localContextKey });
      const cached = previousCache.localModules.get(module.inputPath);
      if (cached?.cacheKey === cacheKey && cached.outputPath === module.outputPath) {
        modules[module.outputPath] = cloneModuleContent(cached.content);
        nextCache.localModules.set(module.inputPath, cloneLocalCacheEntry(cached));
        nextCache.outputPaths.add(module.outputPath);
        for (const packageImport of cached.packageImports) packageImports.add(packageImport);
        reusedModules.add(module.outputPath);
        continue;
      }

      if (typeof transformer.transformSync !== "function" && typeof transformer.transform !== "function") {
        throw new Error("Oxc transform exports transformSync/transform are unavailable.");
      }
      const result = transformer.transformSync
        ? transformer.transformSync(module.inputPath, module.source, transformOptionsForOxc(module.inputPath, input))
        : await transformer.transform!(module.inputPath, module.source, transformOptionsForOxc(module.inputPath, input));
      const code = result?.code;
      const errors = collectArrayLike(result?.errors);
      if (!code || errors.length > 0) {
        events.push(evidence("oxc-transform", "transform", false, transformStart, `${errors.length} transform errors in ${module.inputPath}`));
        diagnostics.push(diagnostic("oxc-transform", "transform-failed", `Oxc transform did not produce JavaScript for ${module.inputPath}.`, errors));
        return failedCompile(diagnostics, events, previousCache, transformedModules, reusedModules, packageGraphRebuilt);
      }

      const processed = processModuleSpecifiersWithOxc(parser, module.outputPath, code, virtualModules, normalizedPackageFiles);
      if (!processed.ok) {
        events.push(evidence("oxc-transform", "transform", false, transformStart, `post-transform import validation failed in ${module.outputPath}`));
        diagnostics.push(...processed.diagnostics);
        return failedCompile(diagnostics, events, previousCache, transformedModules, reusedModules, packageGraphRebuilt);
      }

      for (const packageImport of processed.packageImports) packageImports.add(packageImport);
      modules[module.outputPath] = processed.code;
      nextCache.localModules.set(module.inputPath, {
        cacheKey,
        outputPath: module.outputPath,
        content: processed.code,
        packageImports: processed.packageImports
      });
      nextCache.outputPaths.add(module.outputPath);
      transformedModules.add(module.outputPath);
    }

    for (const [name, virtualModule] of Object.entries(virtualModules)) {
      if (virtualModule.js === undefined) {
        modules[virtualModule.outputPath] = cloneModuleContent(virtualModule.content);
        nextCache.outputPaths.add(virtualModule.outputPath);
        continue;
      }

      const cacheKey = JSON.stringify({ js: virtualModule.js, virtualResolutionKey, packageResolutionKey });
      const cached = previousCache.virtualModules.get(name);
      if (cached?.cacheKey === cacheKey && cached.outputPath === virtualModule.outputPath) {
        modules[virtualModule.outputPath] = cloneModuleContent(cached.content);
        nextCache.virtualModules.set(name, cloneVirtualCacheEntry(cached));
        nextCache.outputPaths.add(virtualModule.outputPath);
        for (const packageImport of cached.packageImports) packageImports.add(packageImport);
        reusedModules.add(virtualModule.outputPath);
        continue;
      }

      const processed = processModuleSpecifiersWithOxc(parser, virtualModule.outputPath, virtualModule.js, virtualModules, normalizedPackageFiles);
      if (!processed.ok) {
        events.push(evidence("oxc-transform", "transform", false, transformStart, `virtual module import validation failed in ${virtualModule.outputPath}`));
        diagnostics.push(...processed.diagnostics);
        return failedCompile(diagnostics, events, previousCache, transformedModules, reusedModules, packageGraphRebuilt);
      }
      for (const packageImport of processed.packageImports) packageImports.add(packageImport);
      const content = { js: processed.code };
      modules[virtualModule.outputPath] = content;
      nextCache.virtualModules.set(name, {
        cacheKey,
        outputPath: virtualModule.outputPath,
        content,
        packageImports: processed.packageImports
      });
      nextCache.outputPaths.add(virtualModule.outputPath);
      transformedModules.add(virtualModule.outputPath);
    }

    const packageImportList = Array.from(packageImports).sort();
    if (normalizedPackageFiles && packageImportList.length > 0) {
      const packageCacheKey = JSON.stringify({ packageImportList, packageFiles: Object.entries(normalizedPackageFiles).sort() });
      const cachedPackageGraph = previousCache.packageGraph;
      if (cachedPackageGraph?.cacheKey === packageCacheKey) {
        const collision = Object.keys(cachedPackageGraph.modules).find((key) => modules[key] !== undefined);
        if (collision !== undefined) {
          diagnostics.push(diagnostic("internal", "transform-failed", `Package module collision would overwrite existing module output: ${collision}`));
          return failedCompile(diagnostics, events, previousCache, transformedModules, reusedModules, packageGraphRebuilt);
        }
        Object.assign(modules, cloneModuleMap(cachedPackageGraph.modules));
        nextCache.packageGraph = clonePackageGraphCacheEntry(cachedPackageGraph);
      } else {
        packageGraphRebuilt = true;
        const packageGraph = await buildPackageModuleGraph(
          packageImportList,
          normalizedPackageFiles,
          (filename, source) => scanModuleSpecifiersWithOxc(parser, filename, source)
        );
        if (!packageGraph.ok) {
          diagnostics.push(...packageGraph.diagnostics);
          return failedCompile(diagnostics, events, previousCache, transformedModules, reusedModules, packageGraphRebuilt);
        }
        const collision = Object.keys(packageGraph.modules).find((key) => modules[key] !== undefined);
        if (collision !== undefined) {
          diagnostics.push(diagnostic("internal", "transform-failed", `Package module collision would overwrite existing module output: ${collision}`));
          return failedCompile(diagnostics, events, previousCache, transformedModules, reusedModules, packageGraphRebuilt);
        }
        Object.assign(modules, cloneModuleMap(packageGraph.modules));
        nextCache.packageGraph = { cacheKey: packageCacheKey, modules: cloneModuleMap(packageGraph.modules) };
      }
      for (const key of Object.keys(nextCache.packageGraph.modules)) nextCache.outputPaths.add(key);
    } else {
      nextCache.packageGraph = undefined;
    }

    const droppedModules = sortedDifference(previousCache.outputPaths, nextCache.outputPaths);
    events.push(evidence("oxc-transform", "transform", true, transformStart, `${transformedModules.size} modules transformed, ${reusedModules.size} modules reused from session cache`));

    return {
      output: {
        ok: true,
        mainModule: graph.mainModule,
        modules,
        diagnostics,
        evidence: events,
        toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "worker-loader" }
      },
      cache: nextCache,
      cacheMetadata: {
        transformedModules: sorted(transformedModules),
        reusedModules: sorted(reusedModules),
        droppedModules,
        graphRebuilt: true,
        packageGraphRebuilt
      }
    };
  } catch (error) {
    events.push(evidence("oxc-transform", "transform", false, transformStart));
    diagnostics.push(diagnostic("oxc-transform", "transform-failed", "Oxc transform imported but failed during cached session compile.", error));
    return failedCompile(diagnostics, events, previousCache, transformedModules, reusedModules, packageGraphRebuilt);
  }
}

function failedCompile(
  diagnostics: ToolchainDiagnostic[],
  events: ToolchainEvidence[],
  previousCache: CompileCacheState,
  transformedModules: Set<string>,
  reusedModules: Set<string>,
  packageGraphRebuilt: boolean,
): { output: ReactWorkerBuildOutput; cache: CompileCacheState; cacheMetadata: DynamicWorkerBuildSessionCacheMetadata } {
  return {
    output: {
      ok: false,
      diagnostics,
      evidence: events,
      toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "none" }
    },
    cache: previousCache,
    cacheMetadata: {
      transformedModules: sorted(transformedModules),
      reusedModules: sorted(reusedModules),
      droppedModules: [],
      graphRebuilt: true,
      packageGraphRebuilt
    }
  };
}

function emptyCacheState(): CompileCacheState {
  return {
    localModules: new Map(),
    virtualModules: new Map(),
    outputPaths: new Set()
  };
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

function cloneLocalCacheEntry(entry: LocalModuleCacheEntry): LocalModuleCacheEntry {
  return {
    cacheKey: entry.cacheKey,
    outputPath: entry.outputPath,
    content: cloneModuleContent(entry.content),
    packageImports: [...entry.packageImports]
  };
}

function cloneVirtualCacheEntry(entry: VirtualModuleCacheEntry): VirtualModuleCacheEntry {
  return {
    cacheKey: entry.cacheKey,
    outputPath: entry.outputPath,
    content: cloneModuleContent(entry.content),
    packageImports: [...entry.packageImports]
  };
}

function clonePackageGraphCacheEntry(entry: PackageGraphCacheEntry): PackageGraphCacheEntry {
  return { cacheKey: entry.cacheKey, modules: cloneModuleMap(entry.modules) };
}

function cloneModuleMap(modules: Record<string, DynamicWorkerModuleContent>): Record<string, DynamicWorkerModuleContent> {
  return Object.fromEntries(Object.entries(modules).map(([path, content]) => [path, cloneModuleContent(content)]));
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

function sortedDifference(previous: Set<string>, next: Set<string>): string[] {
  return Array.from(previous).filter((value) => !next.has(value)).sort();
}

function collectArrayLike(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return [];
  if (Symbol.iterator in value && typeof value[Symbol.iterator] === "function") return Array.from(value as Iterable<unknown>);
  const items: unknown[] = [];
  const indexable = value as Record<number, unknown>;
  for (let index = 0; index < 1000; index += 1) {
    const item = indexable[index];
    if (item === undefined) break;
    items.push(item);
  }
  return items;
}
