import type { Document, FontMapping, ResolvedDocument, Settings } from "../ir/types.js";
import { resolveDocumentSettings } from "./settings-resolver.js";

/**
 * Resolve settings without file I/O. For use in bundled environments (ExtendScript, browser).
 * Settings come from: defaults → inlineConfig → IR document settings.
 */
export function resolveSettingsPure(
  doc: Document,
  inlineConfig?: { fonts?: FontMapping[]; settings?: Partial<Settings> },
): ResolvedDocument {
  return resolveDocumentSettings(doc, inlineConfig);
}
