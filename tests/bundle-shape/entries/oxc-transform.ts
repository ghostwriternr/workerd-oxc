import { compileDynamicWorker } from "../../../src/index";

export default {
  async fetch() {
    const result = await compileDynamicWorker({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": "export default { async fetch() { return new Response('ok') } }",
      },
    });

    return Response.json({ ok: result.ok });
  },
};
