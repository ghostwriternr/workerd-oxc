interface WorkerLoaderDefinition {
  mainModule: string;
  modules: Record<string, string | { js: string } | { cjs: string } | { json: unknown } | { text: string } | { data: ArrayBuffer } | { wasm: ArrayBuffer }>;
  compatibilityDate: string;
  compatibilityFlags?: string[];
}

interface LoadedWorker {
  getEntrypoint(): { fetch(request: Request): Promise<Response> | Response };
}

interface WorkerLoaderBinding {
  get(id: string, factory: () => WorkerLoaderDefinition | Promise<WorkerLoaderDefinition>): LoadedWorker;
}

declare global {
  namespace Cloudflare {
    interface Env {
      LOADER: WorkerLoaderBinding;
    }
  }
}

export {};
