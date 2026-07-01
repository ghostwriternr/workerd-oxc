import { describe, expect, test } from "vitest";

import { experimentalCreateDynamicWorkerBuildSession } from "../../../src/index";

function basicInput(message = "hello") {
  return {
    entrypoint: "src/index.tsx",
    files: {
      "src/index.tsx": `
        export default {
          async fetch() {
            return new Response(${JSON.stringify(message)})
          }
        }
      `,
    },
  };
}

function twoModuleInput(message = "initial") {
  return {
    entrypoint: "src/index.tsx",
    files: {
      "src/index.tsx": `
        import { message } from "./message";
        export default {
          async fetch() {
            return new Response(message)
          }
        }
      `,
      "src/message.tsx": `export const message = ${JSON.stringify(message)};`,
      "src/other.tsx": `export const other = "other";`,
    },
  };
}

describe("experimental Oxc build session", () => {
  test("compiles an initial Dynamic Worker build and reports session metadata", async () => {
    const session = experimentalCreateDynamicWorkerBuildSession(basicInput());

    expect(session.revision).toBe(0);

    const build = await session.compile();

    expect(build.ok).toBe(true);
    expect(build.mainModule).toBe("src/index.js");
    expect(build.modules?.["src/index.js"]).toContain("hello");
    expect(build.session).toEqual({
      revision: 0,
      changedFiles: [],
      deletedFiles: [],
      changedVirtualModules: [],
      deletedVirtualModules: [],
      changedPackageFiles: [],
      deletedPackageFiles: [],
      reusedLastGoodBuild: false,
      lastSuccessfulRevision: 0,
    });
  });

  test("tracks file updates and entrypoint graph changes", async () => {
    const session = experimentalCreateDynamicWorkerBuildSession(twoModuleInput());

    const first = await session.compile();
    expect(first.ok).toBe(true);
    expect(Object.keys(first.modules ?? {}).sort()).toEqual(["src/index.js", "src/message.js"]);

    session.updateFile("src/message.tsx", `export const message = "updated";`);
    expect(session.revision).toBe(1);

    const second = await session.compile();
    expect(second.ok).toBe(true);
    expect(second.modules?.["src/message.js"]).toContain("updated");
    expect(second.session.changedFiles).toEqual(["src/message.tsx"]);
    expect(second.session.deletedFiles).toEqual([]);
    expect(second.session.lastSuccessfulRevision).toBe(1);

    session.updateFile("src/index.tsx", `
      import { other } from "./other";
      export default {
        async fetch() {
          return new Response(other)
        }
      }
    `);

    const third = await session.compile();
    expect(third.ok).toBe(true);
    expect(Object.keys(third.modules ?? {}).sort()).toEqual(["src/index.js", "src/other.js"]);
    expect(third.session.changedFiles).toEqual(["src/index.tsx"]);
    expect(third.session.lastSuccessfulRevision).toBe(2);
  });

  test("preserves the last successful build across failure and recovery", async () => {
    const session = experimentalCreateDynamicWorkerBuildSession(basicInput("good"));

    const good = await session.compile();
    expect(good.ok).toBe(true);
    const lastGood = session.getLastSuccessfulBuild();
    expect(lastGood?.modules?.["src/index.js"]).toContain("good");

    session.updateFile("src/index.tsx", `import "./missing"; export default { async fetch() { return new Response("bad") } }`);
    const failed = await session.compile();
    expect(failed.ok).toBe(false);
    expect(failed.session.changedFiles).toEqual(["src/index.tsx"]);
    expect(failed.session.lastSuccessfulRevision).toBe(0);
    expect(session.getLastSuccessfulBuild()?.modules?.["src/index.js"]).toContain("good");

    session.updateFile("src/index.tsx", `export default { async fetch() { return new Response("recovered") } }`);
    const recovered = await session.compile();
    expect(recovered.ok).toBe(true);
    expect(recovered.modules?.["src/index.js"]).toContain("recovered");
    expect(recovered.session.lastSuccessfulRevision).toBe(2);
    expect(session.getLastSuccessfulBuild()?.modules?.["src/index.js"]).toContain("recovered");
  });

  test("tracks virtual module edits", async () => {
    const session = experimentalCreateDynamicWorkerBuildSession({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `
          import { label } from "app/config";
          export default { async fetch() { return new Response(label) } }
        `,
      },
      virtualModules: {
        "app/config": { js: `export const label = "initial";` },
      },
    });

    const first = await session.compile();
    expect(first.ok).toBe(true);
    expect(first.modules?.["app/config.js"]).toEqual({ js: expect.stringContaining("initial") });

    session.setVirtualModule("app/config", { js: `export const label = "changed";` });
    const second = await session.compile();
    expect(second.ok).toBe(true);
    expect(second.session.changedVirtualModules).toEqual(["app/config"]);
    expect(second.modules?.["app/config.js"]).toEqual({ js: expect.stringContaining("changed") });
  });

  test("tracks package file edits", async () => {
    const session = experimentalCreateDynamicWorkerBuildSession({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `
          import { label } from "pkg";
          export default { async fetch() { return new Response(label) } }
        `,
      },
      packageFiles: {
        "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", exports: "./index.js" }),
        "node_modules/pkg/index.js": `export const label = "initial";`,
      },
    });

    const first = await session.compile();
    expect(first.ok).toBe(true);
    expect(first.modules?.["node_modules/pkg/index.js"]).toEqual({ js: expect.stringContaining("initial") });

    session.setPackageFile("node_modules/pkg/index.js", `export const label = "changed";`);
    const second = await session.compile();
    expect(second.ok).toBe(true);
    expect(second.session.changedPackageFiles).toEqual(["node_modules/pkg/index.js"]);
    expect(second.modules?.["node_modules/pkg/index.js"]).toEqual({ js: expect.stringContaining("changed") });
  });

  test("returns defensive input and last-successful-build copies", async () => {
    const session = experimentalCreateDynamicWorkerBuildSession(basicInput("original"));

    const snapshot = session.snapshotInput();
    snapshot.files["src/index.tsx"] = `export default { async fetch() { return new Response("mutated") } }`;

    const build = await session.compile();
    expect(build.ok).toBe(true);
    expect(build.modules?.["src/index.js"]).toContain("original");

    const firstLastGood = session.getLastSuccessfulBuild();
    expect(firstLastGood?.modules?.["src/index.js"]).toContain("original");
    if (firstLastGood?.modules) {
      firstLastGood.modules["src/index.js"] = "mutated externally";
    }

    const secondLastGood = session.getLastSuccessfulBuild();
    expect(secondLastGood?.modules?.["src/index.js"]).toContain("original");
  });

  test("tracks deletes, reset, and no-op updates deterministically", async () => {
    const session = experimentalCreateDynamicWorkerBuildSession({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `import { value } from "./value"; export default { async fetch() { return new Response(value) } }`,
        "src/value.tsx": `export const value = "value";`,
      },
      virtualModules: {
        "app/config": { js: `export const label = "config";` },
      },
      packageFiles: {
        "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", exports: "./index.js" }),
        "node_modules/pkg/index.js": `export const label = "pkg";`,
      },
    });

    session.updateFile("./src/value.tsx", `export const value = "value";`);
    expect(session.revision).toBe(0);

    session.deleteFile("src/value.tsx");
    session.deleteVirtualModule("app/config");
    session.deletePackageFile("node_modules/pkg/index.js");
    expect(session.revision).toBe(3);

    const failed = await session.compile();
    expect(failed.ok).toBe(false);
    expect(failed.session.deletedFiles).toEqual(["src/value.tsx"]);
    expect(failed.session.deletedVirtualModules).toEqual(["app/config"]);
    expect(failed.session.deletedPackageFiles).toEqual(["node_modules/pkg/index.js"]);

    session.reset(basicInput("reset"));
    expect(session.revision).toBe(4);
    const reset = await session.compile();
    expect(reset.ok).toBe(true);
    expect(reset.session.changedFiles).toEqual([]);
    expect(reset.modules?.["src/index.js"]).toContain("reset");
  });
});
