/**
 * ExtendScript bundle entry point.
 * Exports the core pipeline as a single processAndEmit() function
 * that can be called from the Illustrator ExtendScript exporter.
 */

import { assertUsableArtboardDimensions } from "../core/artboard-dimensions.js";
import { checkSurfaceCapabilities, illustratorCapabilities } from "../core/capabilities.js";
import { computeBreakpoints } from "../core/compute-breakpoints.js";
import { computePositions } from "../core/compute-positions.js";
import { computeStyles } from "../core/compute-styles.js";
import { deduplicateStyles } from "../core/deduplicate-styles.js";
import { groupArtboards } from "../core/group-artboards.js";
import { assertJsonPure } from "../core/json-purity.js";
import { resolveSettingsPure } from "../core/resolve-settings-pure.js";
import { createWarning, type StructuredWarning, warningMessages } from "../core/warnings.js";
import { emitHTMLString } from "../emitters/html-string.js";
import { defaultSettings } from "../ir/defaults.js";
import {
  getSettingDefault,
  SAFE_IDENTIFIER_SETTING_KEYS,
  SAFE_SETTING_IDENTIFIER_RE,
} from "../ir/settings-definitions.js";
import type { Document, FontMapping, Settings } from "../ir/types.js";
import { installPolyfills } from "./polyfills.js";

// Install polyfills on load
installPolyfills();

/**
 * One emitted file. Field names match `EmitFile` in
 * `src/emitters/registry-shared.ts` — the Node registry's file record — so the
 * two surfaces describe an emitted file the same way. The registry itself is not
 * reachable from here: it imports the Svelte and React emitters, which are
 * Node-only, so this path loops the groups and calls the HTML emitter directly.
 */
export interface ProcessFile {
  slug: string;
  extension: string;
  output: string;
}

export interface ProcessResult {
  /**
   * `files[0].output`, or `""` when there is nothing to emit. Kept because
   * `exporter.jsx` and the bundle tests read it, and because a one-file export —
   * still the default — has exactly one file.
   */
  html: string;
  /**
   * One entry per artboard group: a single file under `output: "one-file"`, one
   * per artboard base name under `output: "multiple-files"`. Only empty for a
   * document with no artboards in `multiple-files` mode, which `exporter.jsx`
   * rejects before it gets here.
   */
  files: ProcessFile[];
  /** Plain-string projection of `structuredWarnings`, kept for the ExtendScript exporters. */
  warnings: string[];
  structuredWarnings: StructuredWarning[];
}

/**
 * Process an IR document and emit HTML.
 * This is the main API called by design tool exporters.
 *
 * JSON purity (SPEC 12.2 / decision D21) is asserted here at two boundaries — the
 * resolved input and the emitter-ready output — rather than after every transform as
 * `pipeline-shared.ts` does. Two reasons this path needs its own assertions at all:
 * there is no `loadAndValidateIR` here, so Zod never sees the document and a caller
 * can hand in `settings.maxWidth: Infinity`, which used to reach the stylesheet as
 * `max-width: Infinitypx`; and "the shared pipeline covers it" was never true of a
 * path that does not call the shared pipeline.
 *
 * Two boundaries rather than five is a measured tradeoff (numbers in `json-purity.ts`):
 * the walk costs roughly as much as the transform stage itself, and this is the slowest
 * runtime we ship to. Entry plus exit catches every sentinel that is still a *number* at
 * the exit boundary — settings and every computed numeric field ride on the document — it
 * just names the boundary instead of the individual transform. Node/browser callers keep
 * the finer attribution.
 *
 * What entry+exit cannot catch, at any boundary count: a transform that divides and
 * *stringifies* in one expression. `compute-positions.ts` writes
 * `${round((pos.x / artboardWidth) * 100)}%`, so a zero-width artboard reaches the
 * emitter as the string `"Infinity%"` and the walk — which tests `typeof === "number"` —
 * sees nothing. Zod closes that at input on the shared path (`width: z.number().positive()`);
 * here `assertUsableArtboardDimensions` does, because the artboard dimensions are the only
 * divisors in this bundle. The claim and the guard now match.
 */
// Per-transform timing through the exporter's diagnostics hook. The
// ObservableLogger seam is unavailable here — this bundle is eval'd as a string
// inside Illustrator and has no way to receive options. Without these, the core
// is a single opaque span in the export log.
//
// `$` exists only inside ExtendScript; elsewhere the reference throws and is
// swallowed.
declare const $: { global: Record<string, unknown> };
let phaseStart = 0;
function phase(name: string): void {
  try {
    const now = new Date().getTime();
    const hook = $.global.__ALL2HTML_LOG__;
    if (typeof hook === "function") {
      (hook as (a: string, b: string, c: string) => void)(
        "core",
        "info",
        `core:${name} ${now - phaseStart}ms`,
      );
    }
    phaseStart = now;
  } catch (_e) {
    /* not ExtendScript */
  }
}

/**
 * `namespace`, `projectName` and `svgIdPrefix` reach CSS selectors and ids
 * **unescaped** (`src/emitters/shared/css.ts` concatenates `settings.namespace`
 * straight into every rule), so a value such as `g-}body{display:none}.` injects
 * arbitrary CSS. Zod rejects that at the `string-safe` boundary — but the
 * production Illustrator surface never runs Zod: `exporter.jsx` copies the value
 * out of the `ai2html-settings` text block directly into `settings`. Every
 * Zod-free caller enters through this bundle, so the check belongs here rather
 * than in one exporter.
 *
 * A rejected value falls back to its declared default instead of aborting: the
 * desk gets the graphic plus a named warning, not a dead export.
 *
 * Mutates in place, and takes the settings bag rather than the document, because
 * the only caller hands it the object `resolveDocumentSettings` allocated one
 * line earlier and nothing else holds a reference. A clone here costs `__assign`
 * twice in a bundle that is measured in bytes.
 */
function sanitizeIdentifierSettings(settings: Settings, warnings: StructuredWarning[]): void {
  for (let i = 0; i < SAFE_IDENTIFIER_SETTING_KEYS.length; i++) {
    const key = SAFE_IDENTIFIER_SETTING_KEYS[i];
    const value = settings[key];
    if (typeof value !== "string") continue;
    if (value === "" || SAFE_SETTING_IDENTIFIER_RE.test(value)) continue;
    const fallback = getSettingDefault(key);
    settings[key] = fallback;
    warnings.push(
      createWarning(
        "setting:invalid-value",
        "setting",
        'Setting "' +
          key +
          '" must be a CSS-safe identifier (letters, digits, "_", "-"); "' +
          value +
          '" is not. Using "' +
          fallback +
          '" instead.',
        { setting: key, surface: "illustrator" },
      ),
    );
  }
}

export function processAndEmit(
  irDoc: Document,
  config?: { fonts?: FontMapping[]; settings?: Partial<Settings> },
): ProcessResult {
  const warnings: StructuredWarning[] = [];
  phaseStart = new Date().getTime();
  phase("enter");

  // Before anything divides by them. There is no Zod on this path, and a bad
  // divisor is stringified into CSS on the same line it is created.
  assertUsableArtboardDimensions(irDoc, "processAndEmit");
  phase("assertUsableArtboardDimensions");

  const resolved = resolveSettingsPure(irDoc, config);
  phase("resolveSettingsPure");
  // Before any transform reads them: there is no Zod on this path, so a
  // metacharacter in `namespace`/`projectName` would be concatenated into CSS.
  sanitizeIdentifierSettings(resolved.settings, warnings);
  assertJsonPure(resolved, "resolveSettings");
  phase("assertJsonPure:resolved");
  // Illustrator declares what it honors like every other surface; anything the
  // user set that the exporter will not act on warns here (SPEC 12.5).
  const capabilityWarnings = checkSurfaceCapabilities(illustratorCapabilities, resolved.settings, {
    surface: "illustrator",
    path: "render",
    format: "html",
  });
  for (let i = 0; i < capabilityWarnings.length; i++) warnings.push(capabilityWarnings[i]);
  phase("checkSurfaceCapabilities");
  // After the capability check (which must see the user's request): the
  // exporter writes every image flat next to the HTML and never creates an
  // imageOutputPath subfolder, so the only src prefix that matches the files
  // on disk is none at all. Leaving the resolved default ("all2html-output/")
  // in place shipped HTML whose images 404 on every live export.
  resolved.settings.imageOutputPath = "";
  const withBreakpoints = computeBreakpoints(resolved);
  phase("computeBreakpoints");
  const { document: styled, warnings: styleWarnings } = computeStyles(withBreakpoints);
  warnings.push(...styleWarnings);
  phase("computeStyles");
  const deduped = deduplicateStyles(styled);
  phase("deduplicateStyles");
  const ready = computePositions(deduped);
  phase("computePositions");
  assertJsonPure(ready, "the pipeline");
  phase("assertJsonPure:ready");
  // `output: "multiple-files"` is honored here, not in the exporter: the grouping
  // rule (base name -> responsive group) is tool-agnostic, so it belongs to the
  // core (KB1). One group in `one-file` mode, which is byte-identical to the
  // ungrouped emit that used to run — `scopeArtboards` filters the document's own
  // artboard list, so passing every artboard back in changes neither order nor
  // content, and the group slug is the same `projectName || metadata.slug` the
  // emitter would have defaulted to.
  const groups = groupArtboards(ready);
  phase("groupArtboards");
  // Written verbatim, exactly as `exporter.jsx` did when it owned the filename:
  // no dot is inserted for a malformed value, because that would rename files for
  // documents that export fine today.
  const extension = ready.settings.htmlOutputExtension || ".html";
  const files: ProcessFile[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const emitted = emitHTMLString(ready, { artboards: group.artboards, slug: group.slug });
    for (let j = 0; j < emitted.structuredWarnings.length; j++) {
      warnings.push(emitted.structuredWarnings[j]);
    }
    files.push({ slug: group.slug, extension: extension, output: emitted.html });
  }
  phase("emitHTMLString");

  return {
    html: files.length > 0 ? files[0].output : "",
    files: files,
    warnings: warningMessages(warnings),
    structuredWarnings: warnings,
  };
}

export { defaultSettings };
