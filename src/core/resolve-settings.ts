import { readFileSync } from "node:fs";
import type { EmitterConfig } from "../emitters/types.js";
import { defaultSettings } from "../ir/defaults.js";
import type { Document, FontMapping, ResolvedDocument, Settings } from "../ir/types.js";
import {
  type All2HtmlConfig,
  getConfigFonts,
  getConfigSettings,
  getEmitterConfig,
  parseConfigText,
} from "./config.js";

export function readConfigFile(path: string): All2HtmlConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (error: any) {
    throw new Error(`Failed to read config file "${path}": ${error.message}`);
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

function mergeFonts(base: FontMapping[], override: FontMapping[]): FontMapping[] {
  const merged = [...base];
  for (const font of override) {
    const idx = merged.findIndex((f) => f.aifont === font.aifont);
    if (idx >= 0) {
      merged[idx] = font;
    } else {
      merged.push(font);
    }
  }
  return merged;
}

export function resolveSettings(doc: Document, configPath?: string): ResolvedDocument {
  let resolvedSettings: Settings = { ...defaultSettings };
  let fonts = [...doc.fonts];

  // Merge config file settings
  if (configPath) {
    const config = readConfigFile(configPath);
    const configSettings = getConfigSettings(config);
    if (configSettings) {
      resolvedSettings = { ...resolvedSettings, ...configSettings };
    }
    const configFonts = getConfigFonts(config);
    if (configFonts) {
      fonts = mergeFonts(fonts, configFonts);
    }
  }

  // Merge IR settings (from ai2html-settings block) — highest priority
  resolvedSettings = { ...resolvedSettings, ...doc.settings };

  // Use projectName from settings, fallback to slug
  if (!resolvedSettings.projectName) {
    resolvedSettings.projectName = doc.metadata.slug;
  }

  return {
    ...doc,
    fonts,
    settings: resolvedSettings,
    artboards: doc.artboards.map((ab) => ({
      ...ab,
      breakpoint: { minWidth: 0, maxWidth: Infinity, widthRangeMin: 0, widthRangeMax: Infinity },
    })),
  };
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
