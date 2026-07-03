import { execFileSync } from "node:child_process";

const expectedFiles = [
  "package/Cargo.lock",
  "package/Cargo.toml",
  "package/LICENSE",
  "package/README.md",
  "package/dist/index.d.ts",
  "package/dist/index.js",
  "package/dist/index.js.map",
  "package/dist/parser.js",
  "package/dist/parser.js.map",
  "package/dist/transform.js",
  "package/dist/transform.js.map",
  "package/dist/analyze.js",
  "package/dist/analyze.js.map",
  "package/dist/source.js",
  "package/dist/source.js.map",
  "package/dist/wasm/analyze.wasm",
  "package/native/abi/Cargo.toml",
  "package/native/abi/src/lib.rs",
  "package/native/analyze/Cargo.toml",
  "package/native/analyze/src/diagnostics.rs",
  "package/native/analyze/src/facts/bindings.rs",
  "package/native/analyze/src/facts/imports_exports.rs",
  "package/native/analyze/src/facts/jsx.rs",
  "package/native/analyze/src/facts/literal.rs",
  "package/native/analyze/src/facts/mod.rs",
  "package/native/analyze/src/facts/references.rs",
  "package/native/analyze/src/facts/scopes.rs",
  "package/native/analyze/src/lib.rs",
  "package/native/analyze/src/payload.rs",
  "package/native/analyze/src/source.rs",
  "package/dist/wasm/parser.wasm",
  "package/dist/wasm/transform.wasm",
  "package/native/parser/Cargo.toml",
  "package/native/parser/src/lib.rs",
  "package/native/transform/Cargo.toml",
  "package/native/transform/src/lib.rs",
  "package/package.json",
  "package/rust-toolchain.toml",
];

const output = execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--dry-run"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

const packs = JSON.parse(output);
if (!Array.isArray(packs) || packs.length !== 1) {
  console.error(
    `expected exactly one npm pack result, got ${Array.isArray(packs) ? packs.length : typeof packs}`,
  );
  process.exit(1);
}

const [pack] = packs;
const actualFiles = pack.files.map((file) => `package/${file.path}`).sort();
const expected = [...expectedFiles].sort();
const failures = [];

for (const file of expected) {
  if (!actualFiles.includes(file)) failures.push(`missing expected file: ${file}`);
}

for (const file of actualFiles) {
  if (!expected.includes(file)) failures.push(`unexpected file included: ${file}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`pack shape ok: ${actualFiles.length} files, ${pack.size} bytes`);
