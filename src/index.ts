import { diagnostic } from "./diagnostics";
import { TSX_COMPONENT_FIXTURE } from "./fixtures";
import { toLoaderDefinition, loadDynamicWorker } from "./loader";
import { checkWithOxcParser, transformEntrypointWithOxc } from "./oxc/transform";
import { describeUnsupportedDevelopmentTools } from "./experiments/classify";
import type {
  CompileDiagnostic,
  CompileInput,
  CompileOutput,
  ReactWorkerBuildInput,
  ReactWorkerBuildOutput,
  SourceCheckResult,
  ToolchainDiagnostic
} from "./types";

export type * from "./types";
export { TSX_COMPONENT_FIXTURE, WORKER_ENTRY_FIXTURE, REACT_WORKER_FIXTURE } from "./fixtures";
export { toLoaderDefinition, loadDynamicWorker };
export { dynamicWorkerBuildId, hashDynamicWorkerBuild } from "./build-id";
export { experimentalCreateDynamicWorkerBuildSession } from "./oxc/session";

/**
 * Compile a workerd-targeted React/TSX Worker into modules suitable for the
 * Dynamic Workers / Worker Loader binding.
 *
 * This intentionally models the product workflow rather than individual tool
 * demos: Oxc's parser/transform path is the active workerd compiler path for
 * local relative Worker module graphs and constrained package snapshots.
 * Rolldown remains in `src/experiments/` as blocked bundling evidence rather
 * than a public compile step.
 */
export async function compileDynamicWorker(input: ReactWorkerBuildInput): Promise<ReactWorkerBuildOutput> {
  return transformEntrypointWithOxc(input);
}

/**
 * Development-loop check for arbitrary React/TSX source. Today this is an Oxc
 * parser viability test in workerd; it does not pretend to be type checking.
 */
export async function checkReactTsx(sourceOrInput: string | ReactWorkerBuildInput): Promise<SourceCheckResult> {
  if (typeof sourceOrInput === "string") {
    return checkWithOxcParser(sourceOrInput, "input.tsx");
  }

  const diagnostics: ToolchainDiagnostic[] = [];
  const evidence = [];
  for (const [file, source] of Object.entries(sourceOrInput.files)) {
    if (!/\.[cm]?[tj]sx?$/.test(file)) continue;
    const result = await checkWithOxcParser(source, file);
    diagnostics.push(...result.diagnostics);
    evidence.push(...result.evidence);
  }
  return { ok: diagnostics.length === 0, diagnostics, evidence };
}

/**
 * Summarize the non-runtime parts of the VoidZero/Ox/Vite family for this
 * specific workerd-builder objective. This is intentionally not a probe API;
 * it is a dev-loop capability explanation exposed so tests and README can use
 * the same structured data.
 */
export async function explainDevelopmentTooling(): Promise<SourceCheckResult> {
  return describeUnsupportedDevelopmentTools();
}

// Original-prompt compatibility functions. They delegate to the focused API.
export async function compileTsx(input: CompileInput): Promise<CompileOutput> {
  const result = await compileDynamicWorker({ files: input.files, entrypoint: input.entry });
  const mainModuleContent = result.mainModule && result.modules ? result.modules[result.mainModule] : undefined;
  return {
    mainModule: result.mainModule,
    modules: result.modules,
    code: typeof mainModuleContent === "string"
      ? mainModuleContent
      : mainModuleContent && "js" in mainModuleContent
        ? mainModuleContent.js
        : undefined,
    diagnostics: result.diagnostics.map(toCompileDiagnostic),
    toolchain: {
      parser: result.toolchain.parser,
      transformer: result.toolchain.transformer,
      bundler: result.toolchain.bundler,
      loaderTarget: result.toolchain.loaderTarget === "worker-loader" ? "worker-loader" : "unknown"
    }
  };
}

export async function parseTsx(source: string): Promise<CompileDiagnostic[]> {
  const result = await checkReactTsx(source || TSX_COMPONENT_FIXTURE);
  return result.diagnostics.map(toCompileDiagnostic);
}

export async function lintTsx(_input: CompileInput): Promise<CompileDiagnostic[]> {
  return [
    toCompileDiagnostic(
      diagnostic(
        "oxlint",
        "not-applicable",
        "Oxlint is not exposed as a workerd runtime lint API for this Worker Loader builder objective."
      )
    )
  ];
}

function toCompileDiagnostic(d: ToolchainDiagnostic): CompileDiagnostic {
  const source = d.tool.startsWith("oxc") || d.tool === "oxlint" || d.tool === "oxfmt"
    ? "oxc"
    : d.tool.startsWith("rolldown")
      ? "rolldown"
      : d.tool.startsWith("vite")
        ? "vite"
        : d.tool === "worker-loader"
          ? "worker-loader"
          : "internal";
  return {
    source,
    severity: d.severity,
    message: d.cause ? `${d.message} (${d.cause})` : d.message,
    file: d.file,
    line: d.line,
    column: d.column
  };
}
