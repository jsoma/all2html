import { readFileSync } from "node:fs";
import type { Document, ResolvedDocument } from "../ir/types.js";
import {
  type All2HtmlConfig,
  getConfigFonts,
  getConfigSettings,
  parseConfigText,
} from "./config.js";
import { resolveDocumentSettings } from "./settings-resolver.js";

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

// Removed: `parseConfigSettings(config)`. It had no caller anywhere — not in
// `src/`, not in `test/`, and it was never re-exported from `src/index.ts`, so
// it was not public API either. `resolveSettings()` below is its replacement:
// it is the only thing that ever needed config settings, and it reads them via
// `getConfigSettings(readConfigFile(path))` directly.
export function resolveSettings(doc: Document, configPath?: string): ResolvedDocument {
  if (configPath) {
    const config = readConfigFile(configPath);
    return resolveDocumentSettings(doc, {
      fonts: getConfigFonts(config),
      settings: getConfigSettings(config),
    });
  }

  return resolveDocumentSettings(doc);
}
