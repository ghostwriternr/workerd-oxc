import type { OxcLanguage } from "./types.ts";

export function languageForFilename(filename: string): OxcLanguage {
  if (filename.endsWith(".tsx")) return "tsx";
  if (filename.endsWith(".ts") || filename.endsWith(".mts") || filename.endsWith(".cts")) {
    return "ts";
  }
  if (filename.endsWith(".jsx")) return "jsx";
  return "js";
}

export function isTypeScriptFilename(filename: string): boolean {
  return (
    filename.endsWith(".ts") ||
    filename.endsWith(".tsx") ||
    filename.endsWith(".mts") ||
    filename.endsWith(".cts")
  );
}

export function stringifyJsonOptions(value: unknown, operation: string): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error(`${operation} options must be JSON-serializable.`);
  return json;
}
