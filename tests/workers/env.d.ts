interface WorkerLoaderDefinition {
  mainModule: string;
  modules: Record<string, string>;
  compatibilityDate: string;
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
