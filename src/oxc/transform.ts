import { WASI } from "@bjorn3/browser_wasi_shim";
import { instantiateNapiModule } from "@alexbruf/wasmkernel/worker";
import wasmkernelModule from "@alexbruf/wasmkernel/wasmkernel.wasm";
import oxcParserBytes from "../wasm/oxc-parser.wasm.bin";
import oxcTransformBytes from "../wasm/oxc-transform.wasm.bin";
import { diagnostic, diagnosticAtSourceOffset, evidence, isProbablyWorkerd } from "../diagnostics";
import { buildLocalModuleGraph, type ModuleSpecifier } from "./module-graph";
import { buildPackageModuleGraph, resolvePackageSpecifier } from "./package-resolver";
import type {
  DynamicWorkerModuleContent,
  DynamicWorkerVirtualModuleContent,
  ReactWorkerBuildInput,
  ReactWorkerBuildOutput,
  SourceCheckResult,
  ToolchainDiagnostic,
  ToolchainEvidence
} from "../types";

type OxcModuleRequest = { value?: string; start: number; end: number };

export type NormalizedVirtualModule = {
  outputPath: string;
  content: DynamicWorkerModuleContent;
  js?: string;
};

type OxcStaticImportEntry = { isType?: boolean };

type OxcStaticImport = {
  moduleRequest: OxcModuleRequest;
  entries?: OxcStaticImportEntry[];
};

type OxcStaticExportEntry = {
  moduleRequest?: OxcModuleRequest | null;
  isType?: boolean;
};

type OxcStaticExport = {
  entries?: OxcStaticExportEntry[];
};

type OxcDynamicImport = {
  moduleRequest?: OxcModuleRequest;
  start: number;
  end: number;
};

type OxcParseResult = {
  errors?: unknown[];
  module?: {
    staticImports?: OxcStaticImport[];
    staticExports?: OxcStaticExport[];
    dynamicImports?: OxcDynamicImport[];
  };
};

export type OxcParser = {
  parseSync?: (filename: string, source: string, options?: unknown) => OxcParseResult;
};

type OxcTransformResult = { code?: string; errors?: unknown[] };

export type OxcTransformer = {
  transform?: (filename: string, source: string, options?: unknown) => OxcTransformResult | Promise<OxcTransformResult>;
  transformSync?: (filename: string, source: string, options?: unknown) => OxcTransformResult;
};

let wasmkernelParserPromise: Promise<OxcParser> | undefined;
let wasmkernelTransformerPromise: Promise<OxcTransformer> | undefined;

function jsxOptions(input: ReactWorkerBuildInput) {
  if (input.jsx?.runtime === "preserve") return "preserve" as const;
  return {
    runtime: input.jsx?.runtime ?? "automatic",
    importSource: input.jsx?.importSource ?? "react",
    development: false
  };
}

export async function checkWithOxcParser(source: string, filename = "input.tsx"): Promise<SourceCheckResult> {
  const diagnostics: ToolchainDiagnostic[] = [];
  const events: ToolchainEvidence[] = [];
  const importStart = performance.now();
  let parser: OxcParser;

  try {
    if (isProbablyWorkerd()) {
      parser = await getWasmkernelOxcParser();
      events.push(evidence("oxc-parser", "import", true, importStart, "instantiated oxc-parser wasm through @alexbruf/wasmkernel"));
    } else {
      parser = await dynamicImport("oxc-parser/src-js/wasm.js") as OxcParser;
      events.push(evidence("oxc-parser", "import", true, importStart, "imported browser/WASI parser entry"));
    }
  } catch (error) {
    events.push(evidence("oxc-parser", "import", false, importStart));
    diagnostics.push(
      diagnostic(
        "oxc-parser",
        "import-failed",
        "Could not initialize Oxc parser for this runtime.",
        error
      )
    );
    return { ok: false, diagnostics, evidence: events };
  }

  const parseStart = performance.now();
  try {
    if (typeof parser.parseSync !== "function") {
      throw new Error("Oxc parser export parseSync is unavailable.");
    }
    const result = parser.parseSync(filename, source, parseOptions(filename));
    const errors = collectArrayLike(result?.errors);
    events.push(evidence("oxc-parser", "parse", errors.length === 0, parseStart, `${errors.length} parser errors`));
    for (const error of errors) {
      diagnostics.push(diagnostic("oxc-parser", "parse-failed", String(error), error));
    }
    return { ok: errors.length === 0, diagnostics, evidence: events };
  } catch (error) {
    events.push(evidence("oxc-parser", "parse", false, parseStart));
    diagnostics.push(diagnostic("oxc-parser", "parse-failed", "Oxc parser imported but failed to parse TSX in workerd.", error));
    return { ok: false, diagnostics, evidence: events };
  }
}

export async function transformEntrypointWithOxc(input: ReactWorkerBuildInput): Promise<ReactWorkerBuildOutput> {
  const diagnostics: ToolchainDiagnostic[] = [];
  const events: ToolchainEvidence[] = [];

  const parserImportStart = performance.now();
  let parser: OxcParser;
  try {
    if (isProbablyWorkerd()) {
      parser = await getWasmkernelOxcParser();
      events.push(evidence("oxc-parser", "import", true, parserImportStart, "instantiated oxc-parser wasm through @alexbruf/wasmkernel"));
    } else {
      parser = await dynamicImport("oxc-parser/src-js/wasm.js") as OxcParser;
      events.push(evidence("oxc-parser", "import", true, parserImportStart, "imported browser/WASI parser entry"));
    }
  } catch (error) {
    events.push(evidence("oxc-parser", "import", false, parserImportStart));
    diagnostics.push(diagnostic("oxc-parser", "import-failed", "Could not initialize Oxc parser for graph discovery.", error));
    return { ok: false, diagnostics, evidence: events, toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "none" } };
  }

  const importStart = performance.now();
  let transformer: OxcTransformer;
  try {
    if (isProbablyWorkerd()) {
      transformer = await getWasmkernelOxcTransformer();
      events.push(evidence("oxc-transform", "import", true, importStart, "instantiated oxc-transform wasm through @alexbruf/wasmkernel"));
    } else {
      transformer = await dynamicImport("oxc-transform/browser.js") as OxcTransformer;
      events.push(evidence("oxc-transform", "import", true, importStart, "imported browser/WASI transform entry"));
    }
  } catch (error) {
    events.push(evidence("oxc-transform", "import", false, importStart));
    diagnostics.push(diagnostic("oxc-transform", "import-failed", "Could not initialize Oxc transform for this runtime.", error));
    return { ok: false, diagnostics, evidence: events, toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "none" } };
  }

  const normalizedVirtualModules = normalizeVirtualModules(input.virtualModules ?? {});
  if (normalizedVirtualModules.diagnostics.length > 0) {
    diagnostics.push(...normalizedVirtualModules.diagnostics);
    return { ok: false, diagnostics, evidence: events, toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "none" } };
  }
  const virtualModules = normalizedVirtualModules.modules;

  const normalizedPackageFiles = input.packageFiles ? normalizePackageFiles(input.packageFiles) : undefined;
  const graphInput = normalizedPackageFiles ? { ...input, packageFiles: normalizedPackageFiles } : input;
  const graphStart = performance.now();
  const graph = await buildLocalModuleGraph(graphInput, (filename, source) => scanModuleSpecifiersWithOxc(parser, filename, source));
  events.push(evidence("oxc-transform", "bundle", graph.ok, graphStart, graph.ok ? `${graph.modules?.length ?? 0} local modules resolved from Oxc parser metadata` : "local module graph resolution failed"));
  if (!graph.ok || graph.mainModule === undefined || graph.modules === undefined) {
    diagnostics.push(...graph.diagnostics);
    return { ok: false, diagnostics, evidence: events, toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "none" } };
  }

  const transformStart = performance.now();
  const modules: ReactWorkerBuildOutput["modules"] = {};
  try {
    const packageImports = new Set(graph.packageImports);
    for (const module of graph.modules) {
      if (typeof transformer.transformSync !== "function" && typeof transformer.transform !== "function") {
        throw new Error("Oxc transform exports transformSync/transform are unavailable.");
      }
      const result = transformer.transformSync
        ? transformer.transformSync(module.inputPath, module.source, transformOptions(module.inputPath, input))
        : await transformer.transform!(module.inputPath, module.source, transformOptions(module.inputPath, input));
      const code = result?.code;
      const errors = collectArrayLike(result?.errors);
      if (!code || errors.length > 0) {
        events.push(evidence("oxc-transform", "transform", false, transformStart, `${errors.length} transform errors in ${module.inputPath}`));
        diagnostics.push(diagnostic("oxc-transform", "transform-failed", `Oxc transform did not produce JavaScript for ${module.inputPath}.`, errors));
        return { ok: false, diagnostics, evidence: events, toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "none" } };
      }
      const processed = processModuleSpecifiers(parser, module.outputPath, code, virtualModules, normalizedPackageFiles);
      if (!processed.ok) {
        events.push(evidence("oxc-transform", "transform", false, transformStart, `post-transform import validation failed in ${module.outputPath}`));
        diagnostics.push(...processed.diagnostics);
        return { ok: false, diagnostics, evidence: events, toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "none" } };
      }
      for (const packageImport of processed.packageImports) packageImports.add(packageImport);
      modules[module.outputPath] = processed.code;
    }
    for (const [name, virtualModule] of Object.entries(virtualModules)) {
      if (virtualModule.js === undefined) {
        modules[virtualModule.outputPath] = virtualModule.content;
        continue;
      }

      const processed = processModuleSpecifiers(parser, virtualModule.outputPath, virtualModule.js, virtualModules, normalizedPackageFiles);
      if (!processed.ok) {
        events.push(evidence("oxc-transform", "transform", false, transformStart, `virtual module import validation failed in ${virtualModule.outputPath}`));
        diagnostics.push(...processed.diagnostics);
        return { ok: false, diagnostics, evidence: events, toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "none" } };
      }
      for (const packageImport of processed.packageImports) packageImports.add(packageImport);
      modules[virtualModule.outputPath] = { js: processed.code };
    }

    const packageImportList = Array.from(packageImports);
    if (normalizedPackageFiles && packageImportList.length > 0) {
      const packageGraph = await buildPackageModuleGraph(
        packageImportList,
        normalizedPackageFiles,
        (filename, source) => scanModuleSpecifiersWithOxc(parser, filename, source)
      );
      if (!packageGraph.ok) {
        diagnostics.push(...packageGraph.diagnostics);
        return { ok: false, diagnostics, evidence: events, toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "none" } };
      }
      const collision = Object.keys(packageGraph.modules).find((key) => modules[key] !== undefined);
      if (collision !== undefined) {
        diagnostics.push(diagnostic("internal", "transform-failed", `Package module collision would overwrite existing module output: ${collision}`));
        return { ok: false, diagnostics, evidence: events, toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "none" } };
      }
      Object.assign(modules, packageGraph.modules);
    }

    events.push(evidence("oxc-transform", "transform", true, transformStart, `${graph.modules.length} source modules transformed, ${Object.keys(virtualModules).length} virtual modules emitted`));
    return {
      ok: true,
      mainModule: graph.mainModule,
      modules,
      diagnostics,
      evidence: events,
      toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "worker-loader" }
    };
  } catch (error) {
    events.push(evidence("oxc-transform", "transform", false, transformStart));
    diagnostics.push(diagnostic("oxc-transform", "transform-failed", "Oxc transform imported but failed to transform TSX in workerd.", error));
    return { ok: false, diagnostics, evidence: events, toolchain: { parser: "oxc-parser", transformer: "oxc-transform", loaderTarget: "none" } };
  }
}

export function normalizePackageFilesForOxc(packageFiles: Record<string, string>): Record<string, string> {
  return normalizePackageFiles(packageFiles);
}

function normalizePackageFiles(packageFiles: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [path, source] of Object.entries(packageFiles)) {
    normalized[path.replace(/^\/+/, "").replace(/\\/g, "/")] = source;
  }
  return normalized;
}

export function normalizeVirtualModulesForOxc(virtualModules: NonNullable<ReactWorkerBuildInput["virtualModules"]>): {
  modules: Record<string, NormalizedVirtualModule>;
  diagnostics: ToolchainDiagnostic[];
} {
  return normalizeVirtualModules(virtualModules);
}

function normalizeVirtualModules(virtualModules: NonNullable<ReactWorkerBuildInput["virtualModules"]>): {
  modules: Record<string, NormalizedVirtualModule>;
  diagnostics: ToolchainDiagnostic[];
} {
  const normalized: Record<string, NormalizedVirtualModule> = {};
  const diagnostics: ToolchainDiagnostic[] = [];

  for (const [name, content] of Object.entries(virtualModules)) {
    const module = normalizeVirtualModule(name, content);
    if (module === undefined) {
      diagnostics.push(
        diagnostic(
          "worker-loader",
          "loader-shape-failed",
          `Unsupported virtual module content for ${name}. Supported virtual module object keys are js, json, text, data, and wasm.`
        )
      );
      continue;
    }
    normalized[name] = module;
  }

  return { modules: normalized, diagnostics };
}

function normalizeVirtualModule(name: string, content: DynamicWorkerVirtualModuleContent): NormalizedVirtualModule | undefined {
  if (typeof content === "string") {
    return { outputPath: javaScriptVirtualModuleOutputPath(name), content: { js: content }, js: content };
  }

  if (typeof content !== "object" || content === null) return undefined;

  const keys = Object.keys(content).filter((key) => (content as Record<string, unknown>)[key] !== undefined);
  if (keys.length !== 1) return undefined;

  if ("js" in content && typeof content.js === "string") {
    return { outputPath: javaScriptVirtualModuleOutputPath(name), content: { js: content.js }, js: content.js };
  }

  if ("json" in content) {
    return { outputPath: objectVirtualModuleOutputPath(name), content: { json: content.json } };
  }

  if ("text" in content && typeof content.text === "string") {
    return { outputPath: objectVirtualModuleOutputPath(name), content: { text: content.text } };
  }

  if ("data" in content && content.data instanceof ArrayBuffer) {
    return { outputPath: objectVirtualModuleOutputPath(name), content: { data: content.data } };
  }

  if ("wasm" in content && content.wasm instanceof ArrayBuffer) {
    return { outputPath: objectVirtualModuleOutputPath(name), content: { wasm: content.wasm } };
  }

  return undefined;
}

export function processModuleSpecifiersWithOxc(
  parser: OxcParser,
  filename: string,
  code: string,
  virtualModules: Record<string, NormalizedVirtualModule>,
  packageFiles?: Record<string, string>
): { ok: true; code: string; packageImports: string[]; diagnostics: [] } | { ok: false; code: string; packageImports: string[]; diagnostics: ToolchainDiagnostic[] } {
  return processModuleSpecifiers(parser, filename, code, virtualModules, packageFiles);
}

function processModuleSpecifiers(
  parser: OxcParser,
  filename: string,
  code: string,
  virtualModules: Record<string, NormalizedVirtualModule>,
  packageFiles?: Record<string, string>
): { ok: true; code: string; packageImports: string[]; diagnostics: [] } | { ok: false; code: string; packageImports: string[]; diagnostics: ToolchainDiagnostic[] } {
  const diagnostics: ToolchainDiagnostic[] = [];
  const rewrites: Array<{ start: number; end: number; value: string }> = [];
  const packageImports = new Set<string>();

  let specifiers: ModuleSpecifier[];
  try {
    specifiers = scanModuleSpecifiersWithOxc(parser, filename, code);
  } catch (error) {
    return {
      ok: false,
      code,
      packageImports: [],
      diagnostics: [diagnostic("oxc-transform", "transform-failed", `Could not validate imports in ${filename}.`, error)]
    };
  }

  for (const specifier of specifiers) {
    if (specifier.isTypeOnly) continue;
    if (specifier.kind === "dynamic") {
      diagnostics.push(
        diagnosticAtSourceOffset(
          "oxc-transform",
          "transform-failed",
          `Dynamic imports are not supported by the local Worker Loader graph spike: ${specifier.specifier ?? code.slice(specifier.start, specifier.end)}`,
          { source: code, offset: specifier.start, end: specifier.end, file: filename }
        )
      );
      continue;
    }

    const rawSpecifier = specifier.specifier;
    if (rawSpecifier === undefined) continue;
    if (isRuntimeExternal(rawSpecifier) || isRelativeOrAbsoluteSpecifier(rawSpecifier)) continue;

    const virtualModule = virtualModules[rawSpecifier];
    if (virtualModule !== undefined) {
      rewrites.push({
        start: specifier.start,
        end: specifier.end,
        value: replacementSpecifier(code.slice(specifier.start, specifier.end), `/${virtualModule.outputPath}`)
      });
      continue;
    }

    const packageResolution = packageFiles ? resolvePackageSpecifier(rawSpecifier, packageFiles) : undefined;
    if (packageResolution !== undefined) {
      packageImports.add(rawSpecifier);
      rewrites.push({
        start: specifier.start,
        end: specifier.end,
        value: replacementSpecifier(code.slice(specifier.start, specifier.end), `/${packageResolution.modulePath}`)
      });
      continue;
    }

    diagnostics.push(
      diagnosticAtSourceOffset(
        "oxc-transform",
        "transform-failed",
        `Bare import specifiers are not supported by the local Worker Loader graph spike: ${rawSpecifier}`,
        { source: code, offset: specifier.start, end: specifier.end, file: filename }
      )
    );
  }

  if (diagnostics.length > 0) return { ok: false, code, packageImports: Array.from(packageImports), diagnostics };
  return { ok: true, code: applyRewrites(code, rewrites), packageImports: Array.from(packageImports), diagnostics: [] };
}

function applyRewrites(code: string, rewrites: Array<{ start: number; end: number; value: string }>): string {
  let rewritten = code;
  for (const rewrite of rewrites.sort((a, b) => b.start - a.start)) {
    rewritten = `${rewritten.slice(0, rewrite.start)}${rewrite.value}${rewritten.slice(rewrite.end)}`;
  }
  return rewritten;
}

function replacementSpecifier(original: string, rewritten: string): string {
  const quote = original[0];
  if ((quote === '"' || quote === "'") && original[original.length - 1] === quote) {
    return `${quote}${rewritten}${quote}`;
  }
  return rewritten;
}

function isRelativeOrAbsoluteSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

function isRuntimeExternal(specifier: string): boolean {
  return specifier.startsWith("cloudflare:");
}

function javaScriptVirtualModuleOutputPath(specifier: string): string {
  const normalized = normalizeVirtualModulePath(specifier);
  return /\.[cm]?js$/.test(normalized) ? normalized : `${normalized}.js`;
}

function objectVirtualModuleOutputPath(specifier: string): string {
  return normalizeVirtualModulePath(specifier);
}

function normalizeVirtualModulePath(specifier: string): string {
  const parts: string[] = [];
  for (const part of specifier.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return specifier;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function parseOptions(filename: string) {
  return {
    lang: filename.endsWith(".tsx") ? "tsx" : filename.endsWith(".ts") || filename.endsWith(".mts") ? "ts" : filename.endsWith(".jsx") ? "jsx" : "js",
    sourceType: "module"
  };
}

export function scanModuleSpecifiersWithOxc(parser: OxcParser, filename: string, source: string): ModuleSpecifier[] {
  if (typeof parser.parseSync !== "function") {
    throw new Error("Oxc parser export parseSync is unavailable.");
  }

  const result = parser.parseSync(filename, source, parseOptions(filename));
  const errors = collectArrayLike(result?.errors);
  if (errors.length > 0) {
    throw new Error(`Oxc parser found ${errors.length} errors while scanning ${filename}.`);
  }

  const specifiers: ModuleSpecifier[] = [];
  for (const staticImport of collectArrayLike(result.module?.staticImports) as OxcStaticImport[]) {
    const entries = collectArrayLike(staticImport.entries) as OxcStaticImportEntry[];
    const isTypeOnly = entries.length > 0 && entries.every((entry) => entry.isType === true);
    specifiers.push({
      specifier: staticImport.moduleRequest.value,
      start: staticImport.moduleRequest.start,
      end: staticImport.moduleRequest.end,
      kind: "static",
      isTypeOnly
    });
  }

  for (const staticExport of collectArrayLike(result.module?.staticExports) as OxcStaticExport[]) {
    for (const entry of collectArrayLike(staticExport.entries) as OxcStaticExportEntry[]) {
      if (entry.moduleRequest === undefined || entry.moduleRequest === null) continue;
      specifiers.push({
        specifier: entry.moduleRequest.value,
        start: entry.moduleRequest.start,
        end: entry.moduleRequest.end,
        kind: "static",
        isTypeOnly: entry.isType === true
      });
    }
  }

  for (const dynamicImport of collectArrayLike(result.module?.dynamicImports) as OxcDynamicImport[]) {
    specifiers.push({
      specifier: dynamicImport.moduleRequest?.value,
      start: dynamicImport.moduleRequest?.start ?? dynamicImport.start,
      end: dynamicImport.moduleRequest?.end ?? dynamicImport.end,
      kind: "dynamic"
    });
  }

  return dedupeModuleSpecifiers([
    ...specifiers,
    ...scanExportFromSpecifiers(source),
    ...scanDynamicImportSpecifiers(source)
  ]);
}

function scanExportFromSpecifiers(source: string): ModuleSpecifier[] {
  const codeMask = createCodeMask(source);
  const specifiers: ModuleSpecifier[] = [];
  const exportFromPattern = /\bexport\s+(type\s+)?(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^}]*\}\s*)from\s*(["'])([^"']+)\2/gs;
  for (const match of source.matchAll(exportFromPattern)) {
    if (match.index === undefined || match[2] === undefined || match[3] === undefined) continue;
    if (!codeMask[match.index]) continue;

    const quotedSpecifier = match[2] + match[3] + match[2];
    const start = match.index + match[0].lastIndexOf(quotedSpecifier);
    specifiers.push({
      specifier: match[3],
      start,
      end: start + quotedSpecifier.length,
      kind: "static",
      isTypeOnly: match[1] !== undefined || exportClauseIsTypeOnly(match[0])
    });
  }
  return specifiers;
}

function exportClauseIsTypeOnly(statement: string): boolean {
  const clause = statement.match(/\{([^}]*)\}/s)?.[1];
  if (clause === undefined) return false;
  const entries = clause.split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 && entries.every((entry) => entry.startsWith("type "));
}

function scanDynamicImportSpecifiers(source: string): ModuleSpecifier[] {
  const codeMask = createCodeMask(source);
  const specifiers: ModuleSpecifier[] = [];
  const dynamicImportPattern = /\bimport\s*\(/g;
  for (const match of source.matchAll(dynamicImportPattern)) {
    if (match.index === undefined) continue;
    if (!codeMask[match.index]) continue;

    const argumentStart = skipWhitespace(source, match.index + match[0].length);
    const quote = source[argumentStart];
    if (quote !== '"' && quote !== "'") {
      specifiers.push({ start: match.index, end: match.index + match[0].length, kind: "dynamic" });
      continue;
    }

    const endQuote = findStringEnd(source, argumentStart, quote);
    if (endQuote === -1) {
      specifiers.push({ start: match.index, end: match.index + match[0].length, kind: "dynamic" });
      continue;
    }

    specifiers.push({
      specifier: source.slice(argumentStart + 1, endQuote),
      start: argumentStart,
      end: endQuote + 1,
      kind: "dynamic"
    });
  }
  return specifiers;
}

function createCodeMask(source: string): boolean[] {
  const mask = Array<boolean>(source.length).fill(true);
  for (let index = 0; index < source.length;) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      index = markNonCode(mask, index, end === -1 ? source.length : end);
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = markNonCode(mask, index, end === -1 ? source.length : end + 2);
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      const end = findStringEnd(source, index, char);
      index = markNonCode(mask, index, end === -1 ? source.length : end + 1);
      continue;
    }

    index++;
  }
  return mask;
}

function markNonCode(mask: boolean[], start: number, end: number): number {
  for (let index = start; index < end; index++) mask[index] = false;
  return end;
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index++;
  return index;
}

function findStringEnd(source: string, start: number, quote: string): number {
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === "\\") {
      index++;
      continue;
    }
    if (source[index] === quote) return index;
  }
  return -1;
}

function dedupeModuleSpecifiers(specifiers: ModuleSpecifier[]): ModuleSpecifier[] {
  const seen = new Set<string>();
  return specifiers.filter((specifier) => {
    const key = `${specifier.kind}:${specifier.start}:${specifier.end}:${specifier.specifier ?? ""}:${specifier.isTypeOnly === true}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectArrayLike(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null) return [];

  if (Symbol.iterator in value && typeof value[Symbol.iterator] === "function") {
    const iterated = Array.from(value as Iterable<unknown>);
    if (iterated.length > 0) return iterated;
  }

  const items: unknown[] = [];
  const indexable = value as Record<number, unknown>;
  for (let index = 0; index < 1000; index++) {
    const item = indexable[index];
    if (item === undefined) break;
    items.push(item);
  }
  return items;
}

export async function getOxcParserForRuntime(): Promise<OxcParser> {
  if (isProbablyWorkerd()) return getWasmkernelOxcParser();
  return dynamicImport("oxc-parser/src-js/wasm.js") as Promise<OxcParser>;
}

export async function getOxcTransformerForRuntime(): Promise<OxcTransformer> {
  if (isProbablyWorkerd()) return getWasmkernelOxcTransformer();
  return dynamicImport("oxc-transform/browser.js") as Promise<OxcTransformer>;
}

function getWasmkernelOxcParser(): Promise<OxcParser> {
  wasmkernelParserPromise ??= (async () => {
    const wasi = new WASI([], [], [], { debug: false });
    const { napiModule } = await instantiateNapiModule(new Uint8Array(oxcParserBytes), {
      wasi,
      kernelModule: wasmkernelModule,
      unshareMemory: true
    });
    return napiModule.exports as OxcParser;
  })();
  return wasmkernelParserPromise;
}

function getWasmkernelOxcTransformer(): Promise<OxcTransformer> {
  wasmkernelTransformerPromise ??= (async () => {
    const wasi = new WASI([], [], [], { debug: false });
    const { napiModule } = await instantiateNapiModule(new Uint8Array(oxcTransformBytes), {
      wasi,
      kernelModule: wasmkernelModule,
      unshareMemory: true
    });
    return napiModule.exports as OxcTransformer;
  })();
  return wasmkernelTransformerPromise;
}

export function transformOptionsForOxc(filename: string, input: ReactWorkerBuildInput) {
  return transformOptions(filename, input);
}

function transformOptions(filename: string, input: ReactWorkerBuildInput) {
  return {
    lang: filename.endsWith(".tsx") ? "tsx" : filename.endsWith(".ts") || filename.endsWith(".mts") ? "ts" : filename.endsWith(".jsx") ? "jsx" : "js",
    sourceType: "module",
    typescript: {},
    jsx: jsxOptions(input),
    target: "es2022"
  };
}

function dynamicImport(specifier: string): Promise<unknown> {
  return new Function("specifier", "return import(specifier)")(specifier) as Promise<unknown>;
}
