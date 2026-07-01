import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const OUTPUT_ROOT = join(ROOT, ".tmp", "wrangler-bundle-shape");

export interface BundleFileMeasurement {
  path: string;
  bytes: number;
}

export interface WranglerBundleShape {
  ok: boolean;
  caseName: string;
  entrypoint: string;
  outdir: string;
  metafilePath: string;
  files: BundleFileMeasurement[];
  totalBytes: number;
  metafileInputBytes: number;
  metafileOutputBytes: number;
  wranglerUploadBytes: number;
  wranglerUploadGzipBytes: number;
  startupOk: boolean;
  startupCommand: string[];
  startupStdout: string;
  startupStderr: string;
  command: string[];
  stdout: string;
  stderr: string;
}

export async function measureWranglerBundleShape(caseName: string, entrypoint: string): Promise<WranglerBundleShape> {
  const outdir = join(OUTPUT_ROOT, caseName, "out");
  const configPath = join(OUTPUT_ROOT, caseName, "wrangler.jsonc");
  const metafilePath = join(outdir, "bundle-meta.json");
  const startupProfilePath = join(OUTPUT_ROOT, caseName, "worker-startup.cpuprofile");
  await rm(join(OUTPUT_ROOT, caseName), { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await writeFile(configPath, JSON.stringify(wranglerConfig(caseName, entrypoint, dirname(configPath)), null, 2));

  const command = [
    "wrangler",
    "deploy",
    "--dry-run",
    "--config",
    relative(ROOT, configPath),
    "--outdir",
    relative(ROOT, outdir),
    "--metafile",
    relative(ROOT, metafilePath)
  ];

  let stdout = "";
  let stderr = "";
  let ok = true;
  try {
    const result = await execFileAsync("npx", command, {
      cwd: ROOT,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" }
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    ok = false;
    stdout = typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : "";
    stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : String(error);
  }

  const files = await listFiles(outdir);
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const { metafileInputBytes, metafileOutputBytes } = await readMetafileTotals(metafilePath);
  const { wranglerUploadBytes, wranglerUploadGzipBytes } = parseWranglerUploadSizes(`${stdout}\n${stderr}`);
  const startup = await runWranglerStartupCheck(configPath, startupProfilePath);

  return {
    ok,
    caseName,
    entrypoint,
    outdir: relative(ROOT, outdir),
    metafilePath: relative(ROOT, metafilePath),
    files,
    totalBytes,
    metafileInputBytes,
    metafileOutputBytes,
    wranglerUploadBytes,
    wranglerUploadGzipBytes,
    startupOk: startup.ok,
    startupCommand: startup.command,
    startupStdout: startup.stdout,
    startupStderr: startup.stderr,
    command: ["npx", ...command],
    stdout,
    stderr
  };
}

async function runWranglerStartupCheck(
  configPath: string,
  startupProfilePath: string,
): Promise<{ ok: boolean; command: string[]; stdout: string; stderr: string }> {
  const command = [
    "wrangler",
    "check",
    "startup",
    "--config",
    relative(ROOT, configPath),
    "--outfile",
    relative(ROOT, startupProfilePath)
  ];

  try {
    const result = await execFileAsync("npx", command, {
      cwd: ROOT,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" }
    });
    return {
      ok: true,
      command: ["npx", ...command],
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return {
      ok: false,
      command: ["npx", ...command],
      stdout: typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : "",
      stderr: typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : String(error)
    };
  }
}

function wranglerConfig(caseName: string, entrypoint: string, configDirectory: string): Record<string, unknown> {
  return {
    name: `builder-bundle-shape-${caseName}`,
    main: relative(configDirectory, join(ROOT, entrypoint)),
    compatibility_date: "2026-06-30",
    compatibility_flags: ["nodejs_compat"],
    find_additional_modules: true,
    preserve_file_names: true,
    rules: [
      {
        type: "Data",
        globs: ["**/*.wasm.bin"],
        fallthrough: true
      }
    ]
  };
}

async function listFiles(directory: string): Promise<BundleFileMeasurement[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(absolute);
    if (!entry.isFile()) return [];
    const info = await stat(absolute);
    return [{ path: relative(ROOT, absolute), bytes: info.size }];
  }));
  return files.flat().sort((left, right) => left.path.localeCompare(right.path));
}

async function readMetafileTotals(metafilePath: string): Promise<{ metafileInputBytes: number; metafileOutputBytes: number }> {
  const metafile = JSON.parse(await readFile(metafilePath, "utf8")) as {
    inputs?: Record<string, { bytes?: number }>;
    outputs?: Record<string, { bytes?: number }>;
  };
  return {
    metafileInputBytes: Object.values(metafile.inputs ?? {}).reduce((sum, input) => sum + (input.bytes ?? 0), 0),
    metafileOutputBytes: Object.values(metafile.outputs ?? {}).reduce((sum, output) => sum + (output.bytes ?? 0), 0)
  };
}

function parseWranglerUploadSizes(output: string): { wranglerUploadBytes: number; wranglerUploadGzipBytes: number } {
  const match = /Total Upload:\s+([\d.]+)\s+([KMGT]?i?B)\s+\/\s+gzip:\s+([\d.]+)\s+([KMGT]?i?B)/i.exec(output);
  if (!match) return { wranglerUploadBytes: 0, wranglerUploadGzipBytes: 0 };
  return {
    wranglerUploadBytes: unitToBytes(Number(match[1]), match[2]),
    wranglerUploadGzipBytes: unitToBytes(Number(match[3]), match[4])
  };
}

function unitToBytes(value: number, unit: string): number {
  const normalized = unit.toLowerCase();
  const multiplier = normalized === "b"
    ? 1
    : normalized === "kb" || normalized === "kib"
      ? 1024
      : normalized === "mb" || normalized === "mib"
        ? 1024 ** 2
        : normalized === "gb" || normalized === "gib"
          ? 1024 ** 3
          : normalized === "tb" || normalized === "tib"
            ? 1024 ** 4
            : 1;
  return Math.round(value * multiplier);
}
