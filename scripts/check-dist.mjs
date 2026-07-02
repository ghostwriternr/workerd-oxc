import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/parser.js",
  "dist/transform.js",
  "dist/analyze.js",
  "dist/source.js",
  "dist/wasm/parser.wasm",
  "dist/wasm/transform.wasm",
  "dist/wasm/analyze.wasm",
];

const failures = [];
for (const file of files) {
  try {
    const stat = statSync(file);
    if (!stat.isFile()) failures.push(`${file}: expected file`);
    if (stat.size === 0) failures.push(`${file}: expected non-empty file`);
  } catch (error) {
    failures.push(`${file}: missing (${formatError(error)})`);
  }
}

const jsFiles = readDistFiles()
  .filter((name) => name.endsWith(".js"))
  .map((name) => join("dist", name));

const jsByFile = new Map();
for (const file of jsFiles) {
  try {
    jsByFile.set(file, readFileSync(file, "utf8"));
  } catch (error) {
    failures.push(`${file}: failed to read (${formatError(error)})`);
  }
}

const combinedJs = [...jsByFile.values()].join("\n");
for (const expectedImport of [
  "./wasm/parser.wasm",
  "./wasm/transform.wasm",
  "./wasm/analyze.wasm",
]) {
  if (!combinedJs.includes(expectedImport)) {
    failures.push(`dist JavaScript: missing static wasm import ${expectedImport}`);
  }
}

try {
  const dts = readFileSync("dist/index.d.ts", "utf8");
  if (dts.includes("sourceMappingURL=index.d.ts.map")) {
    failures.push("dist/index.d.ts: references missing declaration map");
  }
} catch (error) {
  failures.push(`dist/index.d.ts: failed to read (${formatError(error)})`);
}

const indexJs = jsByFile.get("dist/index.js") ?? "";
for (const expectedImport of ["./parser.js", "./transform.js", "./analyze.js"]) {
  if (!indexJs.includes(expectedImport)) {
    failures.push(`dist/index.js: missing lazy chunk import ${expectedImport}`);
  }
}

for (const [file, js] of jsByFile) {
  for (const forbidden of ["fetch(", "new URL(", "instantiateStreaming", "compileStreaming"]) {
    if (js.includes(forbidden))
      failures.push(`${file}: forbidden wasm loading pattern ${forbidden}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("dist shape ok");

function readDistFiles() {
  try {
    return readdirSync("dist");
  } catch (error) {
    failures.push(`dist: failed to read directory (${formatError(error)})`);
    return [];
  }
}

function formatError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
