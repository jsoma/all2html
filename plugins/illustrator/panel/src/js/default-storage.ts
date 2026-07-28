import { type FontEntry, normalizeFontEntry } from "../shared/types.js";
import { getUserDataPath } from "./lib/utils/bolt.js";

export interface StoredDefaults<TSettings> {
  version: string;
  settings: TSettings;
  fonts: FontEntry[];
}

/**
 * Reading stored defaults distinguishes "nothing saved yet" from "saved but
 * unreadable": `missing` is silent, `corrupt` must be surfaced to the user
 * (naming the file) so a broken defaults file is not mistaken for a fresh
 * install.
 */
export type StoredDefaultsReadResult<TSettings> =
  | { kind: "missing" }
  | { kind: "corrupt"; error: string }
  | { kind: "ok"; value: StoredDefaults<TSettings> };

function getFs(): typeof import("fs") {
  return (globalThis as any).require("fs") as typeof import("fs");
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeStoredFonts(fonts: FontEntry[] | undefined): FontEntry[] {
  return (fonts || []).map(normalizeFontEntry);
}

/**
 * Read and decode stored panel defaults.
 *
 * The generic settings shape cannot be validated from in here — the two
 * callers store different shapes — so each caller passes its decoder. Decoders
 * normalize recognized fields and drop unknown ones (stored defaults are a
 * convenience layer, not canonical IR). A version this build does not
 * understand is `corrupt`, not silently accepted.
 */
export function readStoredDefaults<TSettings>(
  fileName: string,
  expectedVersion: string,
  decodeSettings: (raw: Record<string, unknown>) => TSettings,
): StoredDefaultsReadResult<TSettings> {
  let fs: typeof import("fs");
  let path: string;
  try {
    fs = getFs();
    path = getUserDataPath() + fileName;
    if (!fs.existsSync(path)) {
      return { kind: "missing" };
    }
  } catch {
    // No Node fs bridge available (e.g. outside CEP): nothing is stored.
    return { kind: "missing" };
  }

  try {
    const raw = fs.readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecordLike(parsed)) {
      return { kind: "corrupt", error: "stored defaults are not a JSON object" };
    }
    if (parsed.version !== expectedVersion) {
      return {
        kind: "corrupt",
        error: `unknown version ${JSON.stringify(parsed.version ?? null)} (expected "${expectedVersion}")`,
      };
    }
    if (!isRecordLike(parsed.settings)) {
      return { kind: "corrupt", error: "stored settings are not a JSON object" };
    }
    if (parsed.fonts !== undefined && !Array.isArray(parsed.fonts)) {
      // Defaulting to [] here silently discards the user's saved mappings;
      // a fonts field of the wrong shape is corruption, not absence.
      return { kind: "corrupt", error: "stored fonts are not a JSON array" };
    }
    return {
      kind: "ok",
      value: {
        version: expectedVersion,
        settings: decodeSettings(parsed.settings),
        fonts: parsed.fonts === undefined ? [] : normalizeStoredFonts(parsed.fonts as FontEntry[]),
      },
    };
  } catch (e) {
    return { kind: "corrupt", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Write stored panel defaults. Throws on failure — a Save-as-Default that
 * silently loses the write is worse than one that reports it.
 */
export function writeStoredDefaults<TSettings>(
  fileName: string,
  version: string,
  settings: TSettings,
  fonts: FontEntry[],
): void {
  const fs = getFs();
  const dir = getUserDataPath();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const data: StoredDefaults<TSettings> = {
    version,
    settings,
    fonts: normalizeStoredFonts(fonts),
  };

  fs.writeFileSync(dir + fileName, JSON.stringify(data, null, 2), "utf-8");
}
