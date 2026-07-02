import { createOxc } from "workerd-oxc";

interface Env {
  LOADER: {
    get(
      id: string,
      factory: () => {
        mainModule: string;
        modules: Record<string, string>;
        compatibilityDate: string;
      },
    ): { getEntrypoint(): { fetch(request: Request): Promise<Response> | Response } };
  };
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const oxc = await createOxc();

    const transformed = await oxc.transform({
      filename: "index.ts",
      source: `
        export default {
          fetch() {
            return new Response("hello from transformed worker");
          }
        };
      `,
      sourcemap: false,
    });

    if (!transformed.ok) {
      return Response.json(transformed.diagnostics, { status: 400 });
    }

    const worker = env.LOADER.get("workerd-oxc-example-v1", () => ({
      mainModule: "index.js",
      modules: {
        "index.js": transformed.value.code,
      },
      compatibilityDate: "2026-06-30",
    }));

    return worker.getEntrypoint().fetch(new Request("https://example.com/"));
  },
};
