import { getUserDataPath } from "./lib/utils/bolt.js";
import { normalizeFontEntry, type FontEntry } from "../shared/types.js";

export interface StoredDefaults<TSettings> {
  version: string;
  settings: TSettings;
  fonts: FontEntry[];
}

function getFs(): typeof import("fs") {
  return (globalThis as any).require("fs") as typeof import("fs");
}

export function normalizeStoredFonts(fonts: FontEntry[] | undefined): FontEntry[] {
  return (fonts || []).map(normalizeFontEntry);
}

export function readStoredDefaults<TSettings>(
  fileName: string,
): StoredDefaults<TSettings> | null {
  try {
    const fs = getFs();
    const path = getUserDataPath() + fileName;
    const raw = fs.readFileSync(path, "utf-8");
    return JSON.parse(raw) as StoredDefaults<TSettings>;
  } catch {
    return null;
  }
}

export function writeStoredDefaults<TSettings>(
  fileName: string,
  version: string,
  settings: TSettings,
  fonts: FontEntry[],
  errorLabel: string,
): void {
  try {
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
  } catch (e) {
    console.error(errorLabel, e);
  }
}
