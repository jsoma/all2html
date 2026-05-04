import { readFileSync } from "node:fs";
import type { EmitterConfig } from "../emitters/types.js";
import type { Document, ResolvedDocument, Settings } from "../ir/types.js";
import {
  type All2HtmlConfig,
  getConfigFonts,
  getConfigSettings,
  getEmitterConfig,
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

export function parseConfigSettings(
  config?: string | All2HtmlConfig,
): Partial<Settings> | undefined {
  if (!config) return undefined;
  return typeof config === "string"
    ? getConfigSettings(readConfigFile(config))
    : getConfigSettings(config);
}

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

/**
 * Parse emitter-specific config from a config file.
 * Returns validated emitter options or undefined if no config/no emit section.
 * Pipeline stays pure — this is called by the CLI alongside processDocument().
 */
export function parseEmitterConfig(config?: string | All2HtmlConfig): EmitterConfig | undefined {
  if (!config) return undefined;
  return typeof config === "string"
    ? getEmitterConfig(readConfigFile(config))
    : getEmitterConfig(config);
}
