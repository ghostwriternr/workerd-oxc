export type ToolName =
  | "oxc-parser"
  | "oxc-transform"
  | "rolldown-browser"
  | "vite"
  | "rolldown-vite"
  | "oxlint"
  | "oxfmt"
  | "worker-loader"
  | "babel-parser"
  | "swc-wasm-web"
  | "internal";

export type DiagnosticKind =
  | "import-failed"
  | "runtime-unsupported"
  | "parse-failed"
  | "transform-failed"
  | "bundle-failed"
  | "loader-shape-failed"
  | "loaded-worker-failed"
  | "not-applicable"
  | "warning";

export interface ToolchainDiagnostic {
  tool: ToolName;
  kind: DiagnosticKind;
  severity: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  cause?: string;
}

export interface ToolchainEvidence {
  tool: ToolName;
  stage: "import" | "parse" | "transform" | "bundle" | "loader-shape" | "worker-loader";
  ok: boolean;
  durationMs?: number;
  detail?: string;
}

export type DynamicWorkerVirtualObjectModuleContent =
  | { js: string }
  | { json: unknown }
  | { text: string }
  | { data: ArrayBuffer }
  | { wasm: ArrayBuffer };

export type DynamicWorkerCjsModuleContent = { cjs: string };

export type DynamicWorkerObjectModuleContent = DynamicWorkerVirtualObjectModuleContent | DynamicWorkerCjsModuleContent;

export type DynamicWorkerVirtualModuleContent = string | DynamicWorkerVirtualObjectModuleContent;

export interface ReactWorkerBuildInput {
  files: Record<string, string>;
  entrypoint: string;
  virtualModules?: Record<string, DynamicWorkerVirtualModuleContent>;
  packageFiles?: Record<string, string>;
  jsx?: {
    runtime?: "automatic" | "classic" | "preserve";
    importSource?: string;
  };
}

export type DynamicWorkerModuleContent = string | DynamicWorkerObjectModuleContent;

export interface DynamicWorkerModules {
  mainModule: string;
  modules: Record<string, DynamicWorkerModuleContent>;
}

export interface ReactWorkerBuildOutput {
  ok: boolean;
  mainModule?: string;
  modules?: Record<string, DynamicWorkerModuleContent>;
  diagnostics: ToolchainDiagnostic[];
  evidence: ToolchainEvidence[];
  toolchain: {
    parser?: ToolName;
    transformer?: ToolName;
    bundler?: ToolName;
    loaderTarget: "worker-loader" | "none";
  };
}

export interface DynamicWorkerBuildSessionCacheMetadata {
  transformedModules: string[];
  reusedModules: string[];
  droppedModules: string[];
  graphRebuilt: boolean;
  packageGraphRebuilt: boolean;
}

export interface DynamicWorkerBuildSessionMetadata {
  revision: number;
  changedFiles: string[];
  deletedFiles: string[];
  changedVirtualModules: string[];
  deletedVirtualModules: string[];
  changedPackageFiles: string[];
  deletedPackageFiles: string[];
  reusedLastGoodBuild: boolean;
  lastSuccessfulRevision?: number;
  cache?: DynamicWorkerBuildSessionCacheMetadata;
}

export interface DynamicWorkerBuildSessionCompileResult extends ReactWorkerBuildOutput {
  session: DynamicWorkerBuildSessionMetadata;
}

export interface DynamicWorkerBuildSession {
  readonly revision: number;
  compile(): Promise<DynamicWorkerBuildSessionCompileResult>;
  updateFile(path: string, source: string): void;
  deleteFile(path: string): void;
  setVirtualModule(path: string, content: DynamicWorkerVirtualModuleContent): void;
  deleteVirtualModule(path: string): void;
  setPackageFile(path: string, source: string): void;
  deletePackageFile(path: string): void;
  reset(input: ReactWorkerBuildInput): void;
  snapshotInput(): ReactWorkerBuildInput;
  getLastSuccessfulBuild(): ReactWorkerBuildOutput | undefined;
}

export interface WorkerLoaderBinding {
  get(
    id: string,
    factory: () => Promise<DynamicWorkerLoaderDefinition> | DynamicWorkerLoaderDefinition
  ): LoadedDynamicWorker;
  load?(definition: DynamicWorkerLoaderDefinition): LoadedDynamicWorker;
}

export interface LoadedDynamicWorker {
  getEntrypoint(): { fetch(request: Request): Promise<Response> | Response };
}

export interface DynamicWorkerLoaderDefinition extends DynamicWorkerModules {
  compatibilityDate: string;
  compatibilityFlags?: string[];
  globalOutbound?: Fetcher | null;
}

export interface SourceCheckResult {
  ok: boolean;
  diagnostics: ToolchainDiagnostic[];
  evidence: ToolchainEvidence[];
}

// Compatibility aliases for the original prompt. The focused API above is what
// this spike actually exercises.
export interface CompileInput {
  files: Record<string, string>;
  entry: string;
}

export interface CompileDiagnostic {
  source:
    | "oxc"
    | "rolldown"
    | "vite"
    | "esbuild"
    | "worker-loader"
    | "internal";
  severity: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface CompileOutput {
  mainModule?: string;
  modules?: Record<string, DynamicWorkerModuleContent>;
  code?: string;
  diagnostics: CompileDiagnostic[];
  toolchain: {
    parser?: string;
    transformer?: string;
    bundler?: string;
    linter?: string;
    formatter?: string;
    loaderTarget?: "worker-loader" | "plain-js" | "unknown";
  };
}
