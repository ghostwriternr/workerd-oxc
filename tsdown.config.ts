import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  format: "esm",
  platform: "browser",
  sourcemap: true,
  fixedExtension: false,
  hash: false,
  deps: {
    skipNodeModulesBundle: true,
    neverBundle: ["./wasm/analyze.wasm"],
  },
});
