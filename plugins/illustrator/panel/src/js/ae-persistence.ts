import { readAeConfigFile } from "./ae-bridge.js";
import {
  normalizeStoredFonts,
  readStoredDefaults,
  writeStoredDefaults,
  type StoredDefaults,
} from "./default-storage.js";
import type {
  AeConfigData,
  AePanelSettings,
  FontEntry,
} from "../shared/types.js";

const DEFAULTS_FILE = "ae-defaults.json";
const SCHEMA_VERSION = "1.0.0";

export type AeAppDefaults = StoredDefaults<AePanelSettings>;

export interface AeResolvedState {
  settings: AePanelSettings;
  fonts: FontEntry[];
  source: "project-config" | "app-defaults" | "core-defaults" | "mixed";
}

export interface ResolveAeStateLayersInput {
  appDefaults?: AeAppDefaults | null;
  config?: unknown;
}

export const aeDefaults: Required<
  Pick<
    AePanelSettings,
    "overlayPrefix" | "outputRoot" | "videoTemplate" | "posterTemplate" | "googleFonts"
  >
> = {
  overlayPrefix: "overlay:",
  outputRoot: "",
  videoTemplate: "",
  posterTemplate: "",
  googleFonts: "none",
};

export function loadAeAppDefaults(): AeAppDefaults | null {
  return readStoredDefaults<AePanelSettings>(DEFAULTS_FILE);
}

export function saveAeAppDefaults(
  settings: AePanelSettings,
  fonts: FontEntry[],
): void {
  writeStoredDefaults(
    DEFAULTS_FILE,
    SCHEMA_VERSION,
    settings,
    fonts,
    "Failed to save AE app defaults:",
  );
}

function normalizeFonts(fonts: FontEntry[] | undefined): FontEntry[] {
  return normalizeStoredFonts(fonts);
}

function normalizeAeSettings(settings: Record<string, unknown>): AePanelSettings {
  const normalized: AePanelSettings = { ...(settings as AePanelSettings) };
  if (
    normalized.googleFonts === undefined &&
    (settings.google_fonts === "none" ||
      settings.google_fonts === "import" ||
      settings.google_fonts === "link")
  ) {
    normalized.googleFonts = settings.google_fonts;
  }
  return normalized;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseSerializedConfig(raw: unknown, maxDepth = 2): Record<string, unknown> | null {
  let current = raw;

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (!current || current === "null") {
      return null;
    }

    if (isRecordLike(current)) {
      return current;
    }

    if (typeof current !== "string") {
      return null;
    }

    try {
      current = JSON.parse(current);
    } catch {
      return null;
    }
  }

  return isRecordLike(current) ? current : null;
}

export function normalizeAeConfigData(raw: unknown): AeConfigData | null {
  const parsed = parseSerializedConfig(raw);
  if (!parsed) return null;

  const settings = isRecordLike(parsed.settings)
    ? normalizeAeSettings(parsed.settings)
    : {};
  const fonts = Array.isArray(parsed.fonts)
    ? normalizeFonts(parsed.fonts as FontEntry[])
    : [];
  const version = typeof parsed.version === "string"
    ? parsed.version
    : SCHEMA_VERSION;

  if (
    typeof parsed.version !== "string"
    && Object.keys(settings).length === 0
    && fonts.length === 0
  ) {
    return null;
  }

  return {
    version,
    settings,
    fonts,
  };
}

export async function resolveAeState(): Promise<AeResolvedState> {
  return resolveAeStateLayers({
    appDefaults: loadAeAppDefaults(),
    config: normalizeAeConfigData(await readAeConfigFile()),
  });
}

export function resolveAeStateLayers(input: ResolveAeStateLayersInput): AeResolvedState {
  const appDefaults = input.appDefaults;
  const config = normalizeAeConfigData(input.config);
  const settings: AePanelSettings = {
    ...aeDefaults,
    ...(appDefaults?.settings || {}),
    ...((config && config.settings) || {}),
  };

  let source: AeResolvedState["source"] = "core-defaults";
  if (appDefaults && config) source = "mixed";
  else if (config) source = "project-config";
  else if (appDefaults) source = "app-defaults";

  const fonts =
    config && config.fonts && config.fonts.length > 0
      ? normalizeFonts(config.fonts)
      : appDefaults && appDefaults.fonts && appDefaults.fonts.length > 0
        ? normalizeFonts(appDefaults.fonts)
        : [];

  return { settings, fonts, source };
}
