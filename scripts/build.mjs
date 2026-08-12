import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "tsdown";

await build();

const dtsPath = "dist/index.d.ts";
const dts = readFileSync(dtsPath, "utf8");
writeFileSync(dtsPath, dts.replace(/\n?\/\/# sourceMappingURL=index\.d\.ts\.map\s*$/, "\n"));

mkdirSync("dist/wasm", { recursive: true });
copyFileSync("src/wasm/analyze.wasm", join("dist", "wasm", "analyze.wasm"));
