import type { FigmaLocalUiState } from "./types.js";

export const DOCUMENT_CONFIG_KEY = "all2html.config";
export const LOCAL_UI_STATE_KEY = "all2html.ui";

export interface PluginDataStoreLike {
  getPluginData(key: string): string;
  setPluginData(key: string, value: string): void;
}

export interface ClientStorageLike {
  getAsync(key: string): Promise<unknown>;
  setAsync(key: string, value: unknown): Promise<void>;
}

export function loadSharedConfig(store: PluginDataStoreLike): string {
  return store.getPluginData(DOCUMENT_CONFIG_KEY) || "";
}

export function saveSharedConfig(store: PluginDataStoreLike, configText: string): string {
  const normalized = configText.trim();
  store.setPluginData(DOCUMENT_CONFIG_KEY, normalized);
  return normalized;
}

export async function loadLocalUiState(storage: ClientStorageLike): Promise<FigmaLocalUiState> {
  const raw = await storage.getAsync(LOCAL_UI_STATE_KEY);
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const format = record.format;
    const advancedOpen = record.advancedOpen;
    const moreSettingsOpen = record.moreSettingsOpen;
    const preset = record.preset;
    if (format === "html" || format === "standalone") {
      return {
        format,
        advancedOpen: typeof advancedOpen === "boolean" ? advancedOpen : false,
        moreSettingsOpen: typeof moreSettingsOpen === "boolean" ? moreSettingsOpen : false,
        preset:
          preset === "standard-story" ||
          preset === "responsive-story" ||
          preset === "image-only-graphic" ||
          preset === "custom"
            ? preset
            : "standard-story",
      };
    }
  }
  return {
    format: "html",
    advancedOpen: false,
    moreSettingsOpen: false,
    preset: "standard-story",
  };
}

export async function saveLocalUiState(
  storage: ClientStorageLike,
  state: FigmaLocalUiState,
): Promise<void> {
  await storage.setAsync(LOCAL_UI_STATE_KEY, state);
}
