import { diagnostic, diagnosticAtSourceOffset } from "../diagnostics";
import type { DynamicWorkerVirtualModuleContent, ReactWorkerBuildInput, ToolchainDiagnostic } from "../types";
import { packageSpecifierDiagnostic, resolvePackageSpecifier } from "./package-resolver";

const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];
const INDEX_FILENAMES = SCRIPT_EXTENSIONS.map((extension) => `/index${extension}`);

export interface LocalModule {
  inputPath: string;
  outputPath: string;
  source: string;
}

export interface LocalModuleGraphResult {
  ok: boolean;
  mainModule?: string;
  modules?: LocalModule[];
  packageImports: string[];
  diagnostics: ToolchainDiagnostic[];
}

export interface ModuleSpecifier {
  specifier?: string;
  start: number;
  end: number;
  kind: "static" | "dynamic";
  isTypeOnly?: boolean;
}

export type ModuleSpecifierScanner = (filename: string, source: string) => ModuleSpecifier[];

interface Rewrite {
  start: number;
  end: number;
  value: string;
}

export async function buildLocalModuleGraph(
  input: ReactWorkerBuildInput,
  scanModuleSpecifiers: ModuleSpecifierScanner
): Promise<LocalModuleGraphResult> {
  const files = normalizeFiles(input.files);
  const virtualModules = input.virtualModules ?? {};
  const entrypoint = normalizeModulePath(input.entrypoint);
  const diagnostics: ToolchainDiagnostic[] = [];
  const packageImports = new Set<string>();

  if (files[entrypoint] === undefined) {
    return {
      ok: false,
      packageImports: [],
      diagnostics: [diagnostic("internal", "transform-failed", `Entrypoint not found: ${input.entrypoint}`)]
    };
  }

  const queue = [entrypoint];
  const seen = new Set<string>();
  const modules: LocalModule[] = [];

  while (queue.length > 0) {
    const inputPath = queue.shift()!;
    if (seen.has(inputPath)) continue;
    seen.add(inputPath);

    const source = files[inputPath];
    if (source === undefined) {
      diagnostics.push(diagnostic("oxc-transform", "transform-failed", `Module not found: ${inputPath}`));
      continue;
    }

    let specifiers: ModuleSpecifier[];
    try {
      specifiers = scanModuleSpecifiers(inputPath, source);
    } catch (error) {
      diagnostics.push(diagnostic("oxc-transform", "transform-failed", `Could not scan imports in ${inputPath}.`, error));
      continue;
    }

    const rewrites: Rewrite[] = [];
    for (const specifier of specifiers) {
      if (specifier.isTypeOnly) continue;

      if (specifier.kind === "dynamic") {
        diagnostics.push(
          diagnosticAtSourceOffset(
            "oxc-transform",
            "transform-failed",
            `Dynamic imports are not supported by the local Worker Loader graph spike: ${specifier.specifier ?? source.slice(specifier.start, specifier.end)}`,
            { source, offset: specifier.start, end: specifier.end, file: inputPath }
          )
        );
        continue;
      }

      const rawSpecifier = specifier.specifier;
      if (rawSpecifier === undefined) {
        diagnostics.push(
          diagnosticAtSourceOffset(
            "oxc-transform",
            "transform-failed",
            `Could not read import specifier in ${inputPath}.`,
            { source, offset: specifier.start, end: specifier.end, file: inputPath }
          )
        );
        continue;
      }

      if (isRuntimeExternal(rawSpecifier)) continue;

      if (!isRelativeSpecifier(rawSpecifier)) {
        if (virtualModules[rawSpecifier] !== undefined) {
          rewrites.push({
            start: specifier.start,
            end: specifier.end,
            value: replacementSpecifier(source.slice(specifier.start, specifier.end), virtualModulePath(rawSpecifier, virtualModules[rawSpecifier]))
          });
          continue;
        }
        const packageResolution = input.packageFiles ? resolvePackageSpecifier(rawSpecifier, input.packageFiles) : undefined;
        if (packageResolution !== undefined) {
          packageImports.add(rawSpecifier);
          rewrites.push({
            start: specifier.start,
            end: specifier.end,
            value: replacementSpecifier(source.slice(specifier.start, specifier.end), `/${packageResolution.modulePath}`)
          });
          continue;
        }
        const packageDiagnostic = input.packageFiles ? packageSpecifierDiagnostic(rawSpecifier, input.packageFiles) : undefined;
        if (packageDiagnostic !== undefined) {
          diagnostics.push(
            diagnosticAtSourceOffset(
              packageDiagnostic.tool,
              packageDiagnostic.kind,
              packageDiagnostic.message,
              { source, offset: specifier.start, end: specifier.end, file: inputPath, cause: packageDiagnostic.cause }
            )
          );
          continue;
        }
        diagnostics.push(
          diagnosticAtSourceOffset(
            "oxc-transform",
            "transform-failed",
            `Bare import specifiers are not supported by the local Worker Loader graph spike: ${rawSpecifier}`,
            { source, offset: specifier.start, end: specifier.end, file: inputPath }
          )
        );
        continue;
      }

      const resolved = resolveRelativeModule(inputPath, rawSpecifier, files);
      if (resolved === undefined) {
        diagnostics.push(
          diagnosticAtSourceOffset(
            "oxc-transform",
            "transform-failed",
            `Could not resolve ${rawSpecifier} imported by ${inputPath}.`,
            { source, offset: specifier.start, end: specifier.end, file: inputPath }
          )
        );
        continue;
      }

      if (!seen.has(resolved)) queue.push(resolved);
      rewrites.push({
        start: specifier.start,
        end: specifier.end,
        value: replacementSpecifier(source.slice(specifier.start, specifier.end), relativeSpecifier(outputPath(inputPath), outputPath(resolved)))
      });
    }

    modules.push({ inputPath, outputPath: outputPath(inputPath), source: applyRewrites(source, rewrites) });
  }

  if (diagnostics.length > 0) {
    return { ok: false, packageImports: Array.from(packageImports), diagnostics };
  }

  return {
    ok: true,
    mainModule: outputPath(entrypoint),
    modules,
    packageImports: Array.from(packageImports),
    diagnostics
  };
}

export function outputPath(path: string): string {
  return normalizeModulePath(path).replace(/\.tsx?$/, ".js").replace(/\.jsx$/, ".js").replace(/\.mts$/, ".js").replace(/\.mjs$/, ".js");
}

function normalizeFiles(files: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [path, source] of Object.entries(files)) {
    normalized[normalizeModulePath(path)] = source;
  }
  return normalized;
}

function resolveRelativeModule(importerPath: string, specifier: string, files: Record<string, string>): string | undefined {
  const base = normalizeModulePath(joinPath(dirname(importerPath), specifier));
  if (base.startsWith("../") || base === "..") return undefined;

  const candidates = hasScriptExtension(base)
    ? [base]
    : [base, ...SCRIPT_EXTENSIONS.map((extension) => `${base}${extension}`), ...INDEX_FILENAMES.map((suffix) => `${base}${suffix}`)];

  return candidates.find((candidate) => files[candidate] !== undefined);
}

function relativeSpecifier(fromOutputPath: string, toOutputPath: string): string {
  const fromParts = dirname(fromOutputPath).split("/").filter(Boolean);
  const toParts = toOutputPath.split("/").filter(Boolean);

  while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }

  const parts = [...fromParts.map(() => ".."), ...toParts];
  const relative = parts.join("/") || basename(toOutputPath);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function replacementSpecifier(original: string, rewritten: string): string {
  const quote = original[0];
  if ((quote === '"' || quote === "'") && original[original.length - 1] === quote) {
    return `${quote}${rewritten}${quote}`;
  }
  return rewritten;
}

function applyRewrites(source: string, rewrites: Rewrite[]): string {
  let rewritten = source;
  for (const rewrite of dedupeRewrites(rewrites).sort((a, b) => b.start - a.start)) {
    rewritten = `${rewritten.slice(0, rewrite.start)}${rewrite.value}${rewritten.slice(rewrite.end)}`;
  }
  return rewritten;
}

function dedupeRewrites(rewrites: Rewrite[]): Rewrite[] {
  const seen = new Set<string>();
  return rewrites.filter((rewrite) => {
    const key = `${rewrite.start}:${rewrite.end}:${rewrite.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function virtualModulePath(specifier: string, content: DynamicWorkerVirtualModuleContent): string {
  return `/${virtualModuleOutputPath(specifier, content)}`;
}

function virtualModuleOutputPath(specifier: string, content: DynamicWorkerVirtualModuleContent): string {
  if (!isJavaScriptVirtualModule(content)) return normalizeModulePath(specifier);
  return /\.[cm]?js$/.test(specifier) ? specifier : `${specifier}.js`;
}

function isJavaScriptVirtualModule(content: DynamicWorkerVirtualModuleContent): boolean {
  return typeof content === "string" || (typeof content === "object" && content !== null && "js" in content && typeof content.js === "string");
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function isRuntimeExternal(specifier: string): boolean {
  return specifier.startsWith("cloudflare:");
}

function hasScriptExtension(path: string): boolean {
  return SCRIPT_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function normalizeModulePath(path: string): string {
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

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}
