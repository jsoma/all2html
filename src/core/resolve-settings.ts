import type { Document, FontMapping, ResolvedDocument, Settings } from "../ir/types.js";
import { resolveDocumentSettings } from "./settings-resolver.js";

// Removed: `parseConfigSettings(config)`. It had no caller anywhere — not in
// `src/`, not in `test/`, and it was never re-exported from `src/index.ts`, so
// it was not public API either. `resolveSettings()` below is its replacement.

/**
 * Resolve settings purely: defaults → inline config → IR document settings.
 *
 * No file I/O — reading a config *file* belongs to the surface that has a
 * filesystem (`readConfigFile` in `src/cli/config-file.ts`), which parses it
 * once and passes the object in. That is what lets this one function serve the
 * CLI, the browser, and the ExtendScript bundle; the old `resolveSettingsPure`
 * twin existed only to keep `readFileSync` out of the bundled surfaces, and
 * collapsed into this when the Node-only branch moved to the CLI.
 */
export function resolveSettings(
  doc: Document,
  config?: { fonts?: FontMapping[]; settings?: Partial<Settings> },
): ResolvedDocument {
  return resolveDocumentSettings(doc, config);
}
