import { experimentalParseReactTsxAstWithOxc } from "../../../src/oxc/ast";

export default {
  async fetch() {
    const result = await experimentalParseReactTsxAstWithOxc(
      "export const value = <div data-kind=\"fixture\" />",
      "fixture.tsx",
    );

    return Response.json({ ok: result.ok });
  },
};
