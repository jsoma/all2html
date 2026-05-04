import { defaultSettings } from "../ir/defaults.js";
import type { Document, FontMapping, ResolvedDocument, Settings } from "../ir/types.js";
import { makeKeyword } from "./identifiers.js";

export interface InlineSettingsConfig {
  fonts?: FontMapping[];
  settings?: Partial<Settings>;
}

export function mergeFonts(base: FontMapping[], override: FontMapping[] = []): FontMapping[] {
  const merged = [...base];
  for (const font of override) {
    const index = merged.findIndex((candidate) => candidate.sourceFont === font.sourceFont);
    if (index >= 0) {
      merged[index] = font;
    } else {
      merged.push(font);
    }
  }
  return merged;
}

export function resolveDocumentSettings(
  doc: Document,
  inlineConfig?: InlineSettingsConfig,
): ResolvedDocument {
  const resolvedSettings: Settings = {
    ...defaultSettings,
    ...inlineConfig?.settings,
    ...doc.settings,
  };

  if (!resolvedSettings.projectName) {
    resolvedSettings.projectName = makeKeyword(doc.metadata.slug, "all2html");
  }

  return {
    ...doc,
    fonts: mergeFonts(doc.fonts, inlineConfig?.fonts),
    settings: resolvedSettings,
    artboards: doc.artboards.map((artboard) => ({
      ...artboard,
      breakpoint: {
        minWidth: 0,
        maxWidth: Number.POSITIVE_INFINITY,
        widthRangeMin: 0,
        widthRangeMax: Number.POSITIVE_INFINITY,
      },
    })),
  };
}
