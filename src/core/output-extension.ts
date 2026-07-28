/**
 * `htmlOutputExtension` is a **filename component**, and every surface accepts it
 * from user-controlled text: the Illustrator `ai2html-settings` text block,
 * `all2html.config.json`, the CEP panel, and the Figma plugin's JSONC.
 *
 * It used to be normalized by ensuring a leading dot and nothing else, so
 * `/../../outside.txt` became `./../../outside.txt` and the CLI's
 * `join(outputDir, slug + extension)` resolved above the selected output
 * directory. The ExtendScript path handed the same string to
 * `writeFile(outputPath + slug + extension)` verbatim. This is the same class as
 * the `projectName` / `metadata.slug` traversal closed by
 * `sanitizeIdentifierSettings` in `src/extendscript/index.ts`, and it is fixed
 * the same way: reject at the one point every surface passes through, fall back
 * to the declared default, and say so with a `setting:invalid-value` warning.
 *
 * The accepted shape is deliberately a *basename suffix*, not a path:
 *
 *     [.] alnum [alnum _ -]{0,15}
 *
 * — one optional leading dot (added when missing, which is the normalization
 * that always happened), a first character that is a letter or digit, and at
 * most 15 more filename-safe characters. That admits `.html`, `.php`, `.htm`,
 * `.shtml`, `.html5` and `php`; it rejects every separator (`/`, `\`), `..`,
 * absolute prefixes, NUL and any other control character, whitespace, quotes,
 * shell metacharacters, and the empty-after-dot case. Interior dots are rejected
 * too — a two-part suffix like `.html.twig` has no user today, and allowing them
 * is what makes `..` a special case to reason about instead of an impossibility.
 *
 * ES3-safe: this module ships inside the ExtendScript bundle. No `startsWith`,
 * no module-scope array work, and the pattern contains no `/` inside a character
 * class (ExtendScript's tokenizer would end the literal there — see
 * `test/integration/extendscript-regex-safety.test.ts`).
 */

import { getSettingDefault } from "../ir/settings-definitions.js";
import { createWarning, type StructuredWarning, type SurfaceId } from "./warnings.js";

/** The one definition of "an extension is a basename suffix". */
export const SAFE_OUTPUT_EXTENSION_RE = /^\.?[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/;

/**
 * Normalize `value` into a leading-dot extension, or fall back to the declared
 * default with a warning when it is not a filename suffix at all.
 *
 * Absent and empty are the "unset" case and resolve to the default silently —
 * that is what `settings.htmlOutputExtension || ".html"` did at every call site
 * before this existed.
 *
 * `surface` is optional because the emitter registry is shared by the CLI, the
 * browser converter and the Figma plugin and does not know which one is running;
 * the ExtendScript entry point does and names itself.
 */
export function resolveOutputExtension(
  value: unknown,
  warnings: StructuredWarning[],
  surface?: SurfaceId,
): string {
  const fallback = getSettingDefault("htmlOutputExtension");
  if (typeof value !== "string" || value === "") return fallback;
  if (SAFE_OUTPUT_EXTENSION_RE.test(value)) {
    return value.charAt(0) === "." ? value : "." + value;
  }
  warnings.push(
    createWarning(
      "setting:invalid-value",
      "setting",
      'Setting "htmlOutputExtension" must be a filename suffix — a dot plus letters, digits, "_" or "-" — and "' +
        value +
        '" is not. It names output files, so a value containing a path separator could write outside the output folder. Using "' +
        fallback +
        '" instead.',
      { setting: "htmlOutputExtension", surface: surface },
    ),
  );
  return fallback;
}
