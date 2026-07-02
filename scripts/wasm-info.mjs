import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const artifacts = [
  {
    path: "src/wasm/parser.wasm",
    requiredFunction: "parse",
  },
  {
    path: "src/wasm/transform.wasm",
    requiredFunction: "transform",
  },
];

const commonExports = [
  "memory:memory",
  "function:abi_version",
  "function:alloc",
  "function:free",
  "function:result_ptr",
  "function:result_len",
  "function:free_result",
];

const check = process.argv.includes("--check");
let failed = false;

for (const artifact of artifacts) {
  console.log(`${artifact.path}`);

  try {
    const bytes = readFileSync(artifact.path);
    const module = new WebAssembly.Module(bytes);
    const imports = WebAssembly.Module.imports(module);
    const exports = WebAssembly.Module.exports(module).map(
      (entry) => `${entry.kind}:${entry.name}`,
    );
    const requiredExports = [...commonExports, `function:${artifact.requiredFunction}`];
    const missingExports = requiredExports.filter((name) => !exports.includes(name));
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    console.log(`  size: ${bytes.byteLength} bytes`);
    console.log(`  sha256: ${sha256}`);
    console.log(`  imports: ${imports.length}`);
    if (imports.length > 0) {
      for (const wasmImport of imports) {
        console.log(`    ${wasmImport.module}.${wasmImport.name} (${wasmImport.kind})`);
      }
    }
    console.log(`  exports: ${exports.map((entry) => entry.replace(/^[^:]+:/, "")).join(", ")}`);

    if (check) {
      if (imports.length > 0) {
        failed = true;
        console.error(`${artifact.path}: expected zero imports`);
      }
      if (missingExports.length > 0) {
        failed = true;
        console.error(`${artifact.path}: missing exports: ${missingExports.join(", ")}`);
      }
    }
  } catch (error) {
    failed = true;
    console.error(`${artifact.path}: failed to read or compile wasm: ${formatError(error)}`);
  }

  if (artifact !== artifacts.at(-1)) console.log();
}

if (failed) {
  console.error(`\nwasm check failed`);
  process.exit(1);
}

if (check) console.log(`\nwasm check ok: ${artifacts.length} artifacts`);

function formatError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
