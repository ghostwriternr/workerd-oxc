import { describe, expect, test } from "vitest";

import { compileDynamicWorker, experimentalCreateDynamicWorkerBuildSession } from "../../../src/index";

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
      cache: {
        transformedModules: ["src/index.js"],
        reusedModules: [],
        droppedModules: [],
        graphRebuilt: true,
        graphScannedModules: ["src/index.tsx"],
        graphReusedModules: [],
        packageGraphRebuilt: false,
      },
    });
  });

  test("tracks file updates and entrypoint graph changes", async () => {
    const session = experimentalCreateDynamicWorkerBuildSession(twoModuleInput());

    const first = await session.compile();
    expect(first.ok).toBe(true);
    expect(Object.keys(first.modules ?? {}).sort()).toEqual(["src/index.js", "src/message.js"]);
    expect(first.session.cache).toMatchObject({
      transformedModules: ["src/index.js", "src/message.js"],
      reusedModules: [],
      droppedModules: [],
      graphRebuilt: true,
      graphScannedModules: ["src/index.tsx", "src/message.tsx"],
      graphReusedModules: [],
      packageGraphRebuilt: false,
    });

    session.updateFile("src/message.tsx", `export const message = "updated";`);
    expect(session.revision).toBe(1);

    const second = await session.compile();
    expect(second.ok).toBe(true);
    expect(Object.keys(second.modules ?? {}).sort()).toEqual(["src/index.js", "src/message.js"]);
    expect(second.modules?.["src/message.js"]).toContain("updated");
    expect(second.session.changedFiles).toEqual(["src/message.tsx"]);
    expect(second.session.deletedFiles).toEqual([]);
    expect(second.session.cache).toMatchObject({
      transformedModules: ["src/message.js"],
      reusedModules: ["src/index.js"],
      droppedModules: [],
      graphRebuilt: true,
      graphScannedModules: ["src/message.tsx"],
      graphReusedModules: ["src/index.tsx"],
      packageGraphRebuilt: false,
    });
    expect(second.session.lastSuccessfulRevision).toBe(1);
    const coldSecond = await compileDynamicWorker(session.snapshotInput());
    expect(coldSecond.ok).toBe(true);
    expect(second.modules).toEqual(coldSecond.modules);

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
    expect(third.session.cache).toMatchObject({
      transformedModules: ["src/index.js", "src/other.js"],
      reusedModules: [],
      droppedModules: ["src/message.js"],
      graphRebuilt: true,
      graphScannedModules: ["src/index.tsx", "src/other.tsx"],
      graphReusedModules: [],
      packageGraphRebuilt: false,
    });
    expect(third.session.lastSuccessfulRevision).toBe(2);
  });

  test("preserves the last successful build and cache across graph-resolution failure and recovery", async () => {
    const session = experimentalCreateDynamicWorkerBuildSession(twoModuleInput("good"));

    const good = await session.compile();
    expect(good.ok).toBe(true);
    const lastGood = session.getLastSuccessfulBuild();
    expect(lastGood?.modules?.["src/message.js"]).toContain("good");

    session.updateFile("src/message.tsx", `export const message = "failed edit";`);
    session.updateFile("src/index.tsx", `import { message } from "./message";
import "./missing";
export default { async fetch() { return new Response(message) } }
`);
    const failed = await session.compile();
    expect(failed.ok).toBe(false);
    expect(failed.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "oxc-transform",
        kind: "transform-failed",
        message: expect.stringContaining("Could not resolve ./missing imported by src/index.tsx"),
        file: "src/index.tsx",
        line: 2,
        column: 8,
        span: { start: 44, end: 55 }
      })
    );
    expect(failed.session.changedFiles).toEqual(["src/index.tsx", "src/message.tsx"]);
    expect(failed.session.cache?.transformedModules).toEqual([]);
    expect(failed.session.cache?.graphScannedModules).toEqual(["src/index.tsx", "src/message.tsx"]);
    expect(failed.session.cache?.graphReusedModules).toEqual([]);
    expect(failed.session.lastSuccessfulRevision).toBe(0);
    expect(session.getLastSuccessfulBuild()?.modules?.["src/message.js"]).toContain("good");

    session.updateFile("src/index.tsx", `import { message } from "./message"; export default { async fetch() { return new Response(message) } }`);
    const recovered = await session.compile();
    expect(recovered.ok).toBe(true);
    expect(recovered.modules?.["src/message.js"]).toContain("failed edit");
    expect(recovered.session.cache).toMatchObject({
      transformedModules: ["src/index.js", "src/message.js"],
      reusedModules: [],
      droppedModules: [],
      graphRebuilt: true,
      graphScannedModules: ["src/index.tsx", "src/message.tsx"],
      graphReusedModules: [],
      packageGraphRebuilt: false,
    });
    expect(recovered.session.lastSuccessfulRevision).toBe(3);
    expect(session.getLastSuccessfulBuild()?.modules?.["src/message.js"]).toContain("failed edit");
  });

  test("does not promote graph scans from failures after graph discovery", async () => {
    const session = experimentalCreateDynamicWorkerBuildSession({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `
          import { message } from "./message";
          import { label } from "pkg";
          export default { async fetch() { return new Response(message + label) } }
        `,
        "src/message.tsx": `export const message = "good";`,
      },
      packageFiles: {
        "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", exports: "./index.js" }),
        "node_modules/pkg/index.js": `export const label = "pkg";`,
      },
    });

    const good = await session.compile();
    expect(good.ok).toBe(true);

    session.updateFile("src/message.tsx", `export const message = "changed before failed package";`);
    session.setPackageFile("node_modules/pkg/index.js", `const name = "pkg"; module.exports = require(name);`);
    const failed = await session.compile();
    expect(failed.ok).toBe(false);
    expect(failed.session.cache?.graphScannedModules).toEqual(["src/message.tsx"]);
    expect(failed.session.cache?.graphReusedModules).toEqual(["src/index.tsx"]);
    expect(session.getLastSuccessfulBuild()?.modules?.["src/message.js"]).toContain("good");

    session.setPackageFile("node_modules/pkg/index.js", `export const label = "fixed";`);
    const recovered = await session.compile();
    expect(recovered.ok).toBe(true);
    expect(recovered.modules?.["src/message.js"]).toContain("changed before failed package");
    expect(recovered.session.cache).toMatchObject({
      transformedModules: ["src/message.js"],
      reusedModules: ["src/index.js"],
      graphScannedModules: ["src/message.tsx"],
      graphReusedModules: ["src/index.tsx"],
      packageGraphRebuilt: true,
    });
  });

  test("tracks virtual module edits and reuses unchanged virtual JS modules", async () => {
    const session = experimentalCreateDynamicWorkerBuildSession({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `
          import { label } from "app/config";
          import { local } from "./local";
          export default { async fetch() { return new Response(label + local) } }
        `,
        "src/local.tsx": `export const local = " local";`,
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

    session.updateFile("src/local.tsx", `export const local = " updated";`);
    const third = await session.compile();
    expect(third.ok).toBe(true);
    expect(Object.keys(third.modules ?? {}).sort()).toEqual(["app/config.js", "src/index.js", "src/local.js"]);
    expect(third.session.cache?.reusedModules).toContain("app/config.js");
    expect(third.modules?.["app/config.js"]).toEqual({ js: expect.stringContaining("changed") });
  });

  test("tracks package file edits and package graph cache invalidation", async () => {
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
        "node_modules/other/package.json": JSON.stringify({ name: "other", exports: "./index.js" }),
        "node_modules/other/index.js": `export const label = "other";`,
      },
    });

    const first = await session.compile();
    expect(first.ok).toBe(true);
    expect(first.session.cache?.packageGraphRebuilt).toBe(true);
    expect(first.modules?.["node_modules/pkg/index.js"]).toEqual({ js: expect.stringContaining("initial") });

    session.updateFile("src/index.tsx", `
      import { label } from "pkg";
      export default { async fetch() { return new Response(label + "!") } }
    `);
    const sameImports = await session.compile();
    expect(sameImports.ok).toBe(true);
    expect(sameImports.session.cache).toMatchObject({
      transformedModules: ["src/index.js"],
      reusedModules: [],
      droppedModules: [],
      graphRebuilt: true,
      packageGraphRebuilt: false,
    });
    expect(sameImports.modules?.["node_modules/pkg/index.js"]).toEqual({ js: expect.stringContaining("initial") });

    session.updateFile("src/index.tsx", `
      import { label } from "other";
      export default { async fetch() { return new Response(label) } }
    `);
    const changedImports = await session.compile();
    expect(changedImports.ok).toBe(true);
    expect(changedImports.session.cache).toMatchObject({
      transformedModules: ["src/index.js"],
      reusedModules: [],
      droppedModules: ["node_modules/pkg/index.js"],
      graphRebuilt: true,
      packageGraphRebuilt: true,
    });
    expect(changedImports.modules?.["node_modules/other/index.js"]).toEqual({ js: expect.stringContaining("other") });
    expect(changedImports.modules?.["node_modules/pkg/index.js"]).toBeUndefined();

    session.setPackageFile("node_modules/other/index.js", `export const label = "changed";`);
    const changedPackageFile = await session.compile();
    expect(changedPackageFile.ok).toBe(true);
    expect(changedPackageFile.session.changedPackageFiles).toEqual(["node_modules/other/index.js"]);
    expect(changedPackageFile.session.cache).toMatchObject({
      transformedModules: [],
      reusedModules: ["src/index.js"],
      droppedModules: [],
      graphRebuilt: true,
      packageGraphRebuilt: true,
    });
    expect(changedPackageFile.modules?.["node_modules/other/index.js"]).toEqual({ js: expect.stringContaining("changed") });
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
