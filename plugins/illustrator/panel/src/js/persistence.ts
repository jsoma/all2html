/**
 * Resolved settings come from four layers:
 * 1. App defaults (CEP user data dir — survives across documents)
 * 2. Config file (project-local all2html.config.json)
 * 3. Document XMP (travels with the .ai file)
 * 4. ai2html-settings text block (authoritative document lock layer)
 *
 * Priority: text block > document XMP > config file > app defaults > core defaults
 */

import { loadXmpSettings, readConfigFile, readSettingsBlock } from "./bridge.js";
import { parseHostObjectResult } from "./bridge-shared.js";
import { exporterToPanelKey, exporterToPanelSettings } from "./adapter.js";
import {
  normalizeStoredFonts,
  readStoredDefaults,
  writeStoredDefaults,
  type StoredDefaults,
} from "./default-storage.js";
import type {
  PanelSettingKey,
  PanelSettings,
  FontEntry,
  SettingSource,
  XmpData,
} from "../shared/types.js";

const DEFAULTS_FILE = "defaults.json";
const SCHEMA_VERSION = "1.0.0";

export type AppDefaults = StoredDefaults<PanelSettings>;

// ============================================================
// Layer 1: App defaults (CEP user data dir)
// ============================================================

/** Load global app defaults from the user data directory. */
export function loadAppDefaults(): AppDefaults | null {
  return readStoredDefaults<PanelSettings>(DEFAULTS_FILE);
}

/** Save global app defaults to the user data directory. */
export function saveAppDefaults(
  settings: PanelSettings,
  fonts: FontEntry[],
): void {
  writeStoredDefaults(
    DEFAULTS_FILE,
    SCHEMA_VERSION,
    settings,
    fonts,
    "Failed to save app defaults:",
  );
}

// ============================================================
// Layer 2: Document XMP
// ============================================================

/** Load settings from the active document's XMP metadata. */
export async function loadDocumentSettings(): Promise<XmpData | null> {
  const raw = await loadXmpSettings();
  return parseHostObjectResult<XmpData>(raw);
}

// ============================================================
// Merged resolution
// ============================================================

export interface ResolvedSettings {
  settings: PanelSettings;
  fonts: FontEntry[];
  source: "document-xmp" | "config-file" | "app-defaults" | "core-defaults" | "mixed";
  fieldSources: Partial<Record<PanelSettingKey, SettingSource>>;
  documentControlledKeys: PanelSettingKey[];
}

function assignSettingSources(
  target: PanelSettings,
  fieldSources: Partial<Record<PanelSettingKey, SettingSource>>,
  sourceSettings: PanelSettings,
  source: SettingSource,
): void {
  for (const [key, value] of Object.entries(sourceSettings) as [
    PanelSettingKey,
    PanelSettings[PanelSettingKey],
  ][]) {
    if (value === undefined) continue;
    (
      target as Partial<Record<PanelSettingKey, PanelSettings[PanelSettingKey]>>
    )[key] = value;
    fieldSources[key] = source;
  }
}

function normalizeFonts(fonts: FontEntry[] | undefined): FontEntry[] {
  return normalizeStoredFonts(fonts);
}

export function summarizeSettingSources(
  fieldSources: Partial<Record<PanelSettingKey, SettingSource>>,
): ResolvedSettings["source"] {
  const meaningfulSources = new Set<ResolvedSettings["source"]>();

  for (const source of Object.values(fieldSources)) {
    if (!source || source === "text-block") continue;
    if (source === "document-xmp" || source === "config-file" || source === "app-defaults") {
      meaningfulSources.add(source);
    }
  }

  if (meaningfulSources.size === 0) return "core-defaults";
  if (meaningfulSources.size === 1) return meaningfulSources.values().next().value ?? "core-defaults";
  return "mixed";
}

export interface ResolveSettingsLayersInput {
  appDefaults?: AppDefaults | null;
  configSettings?: PanelSettings;
  configFonts?: FontEntry[];
  xmpData?: XmpData | null;
  textBlockRaw?: Record<string, unknown>;
}

export function resolveSettingsLayers(
  input: ResolveSettingsLayersInput,
): ResolvedSettings {
  const resolvedSettings: PanelSettings = {};
  const fieldSources: Partial<Record<PanelSettingKey, SettingSource>> = {};
  let fonts: FontEntry[] = [];

  if (input.appDefaults) {
    assignSettingSources(
      resolvedSettings,
      fieldSources,
      input.appDefaults.settings,
      "app-defaults",
    );
    fonts = normalizeFonts(input.appDefaults.fonts);
  }

  if (input.configSettings) {
    assignSettingSources(
      resolvedSettings,
      fieldSources,
      input.configSettings,
      "config-file",
    );
    if ((input.configFonts || []).length > 0) {
      fonts = normalizeFonts(input.configFonts);
    }
  }

  if (input.xmpData?.settings && Object.keys(input.xmpData.settings).length > 0) {
    assignSettingSources(
      resolvedSettings,
      fieldSources,
      input.xmpData.settings,
      "document-xmp",
    );
    if ((input.xmpData.fonts || []).length > 0) {
      fonts = normalizeFonts(input.xmpData.fonts);
    }
  }

  const textBlockRaw = input.textBlockRaw || {};
  const textBlockSettings = exporterToPanelSettings(textBlockRaw);
  const documentControlledKeys = Object.keys(textBlockRaw)
    .map((key) => exporterToPanelKey(key))
    .filter((key): key is PanelSettingKey => key !== undefined);

  return {
    settings: { ...resolvedSettings, ...textBlockSettings },
    fonts,
    source: summarizeSettingSources(fieldSources),
    fieldSources: {
      ...fieldSources,
      ...Object.fromEntries(documentControlledKeys.map((key) => [key, "text-block"] as const)),
    },
    documentControlledKeys,
  };
}

/**
 * Resolve settings by merging each layer in priority order:
 * app defaults → config file → document XMP → text block
 * Core defaults are implicit fallbacks in the panel UI, not stored here directly.
 */
export async function resolveSettings(): Promise<ResolvedSettings> {
  const config = await readConfigFile();
  const xmpData = await loadDocumentSettings();
  const textBlockRaw = await readSettingsBlock();

  return resolveSettingsLayers({
    appDefaults: loadAppDefaults(),
    configSettings: config
      ? exporterToPanelSettings((config.settings ?? {}) as Record<string, unknown>)
      : undefined,
    configFonts: config ? ((config.fonts ?? []) as FontEntry[]) : undefined,
    xmpData,
    textBlockRaw,
  });
}
