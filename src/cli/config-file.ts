import { readFileSync } from "node:fs";
import { type All2HtmlConfig, parseConfigText } from "../core/config.js";

/**
 * Read and parse an `all2html.config.json`.
 *
 * This lives in the CLI, not the core: file I/O belongs to the surface that has
 * a filesystem. Every command (and every watch rebuild) calls this exactly once
 * and passes the resulting object into the pipeline as inline config — the old
 * shape, where the CLI parsed the file for `.emit` and the pipeline re-read the
 * same path for settings, read the file twice with a torn-read window between.
 */
export function readConfigFile(path: string): All2HtmlConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read config file "${path}": ${message}`);
  }
  return parseConfigText(raw, path);
}
