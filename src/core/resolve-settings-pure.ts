import { defaultSettings } from "../ir/defaults.js";
import type { Document, FontMapping, ResolvedDocument, Settings } from "../ir/types.js";

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

/**
 * Resolve settings without file I/O. For use in bundled environments (ExtendScript, browser).
 * Settings come from: defaults → inlineConfig → IR document settings.
 */
export function resolveSettingsPure(
  doc: Document,
  inlineConfig?: { fonts?: FontMapping[]; settings?: Partial<Settings> },
): ResolvedDocument {
  let resolvedSettings: Settings = { ...defaultSettings };
  let fonts = [...doc.fonts];

  if (inlineConfig?.settings) {
    resolvedSettings = { ...resolvedSettings, ...inlineConfig.settings };
  }
  if (inlineConfig?.fonts) {
    fonts = mergeFonts(fonts, inlineConfig.fonts);
  }

  // IR settings (highest priority)
  resolvedSettings = { ...resolvedSettings, ...doc.settings };

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
