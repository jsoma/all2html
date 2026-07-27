/**
 * ExtendScript bundle entry point.
 * Exports the core pipeline as a single processAndEmit() function
 * that can be called from the Illustrator ExtendScript exporter.
 */

import { assertUsableArtboardDimensions } from "../core/artboard-dimensions.js";
import { relativeOutputDirectory } from "../core/artifact-path.js";
import { checkSurfaceCapabilities, illustratorCapabilities } from "../core/capabilities.js";
import { computeBreakpoints } from "../core/compute-breakpoints.js";
import { computePositions } from "../core/compute-positions.js";
import { computeStyles } from "../core/compute-styles.js";
import { deduplicateStyles } from "../core/deduplicate-styles.js";
import { groupArtboards } from "../core/group-artboards.js";
import { assertJsonPure } from "../core/json-purity.js";
import { resolveOutputExtension } from "../core/output-extension.js";
import { resolveSettingsPure } from "../core/resolve-settings-pure.js";
import { createWarning, type StructuredWarning, warningMessages } from "../core/warnings.js";
import { emitHTMLString } from "../emitters/html-string.js";
import { defaultSettings } from "../ir/defaults.js";
import {
  getSettingDefault,
  isValidSettingValue,
  SAFE_SETTING_IDENTIFIER_RE,
  SETTING_DEFINITIONS,
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
 * The production Illustrator surface cannot ship Zod, so resolved settings
 * used to receive only whichever individual guards had been added after a bug:
 * safe identifiers, then extensions, while enum and range constraints remained
 * unenforced. `isValidSettingValue` derives every constraint from the same
 * SETTING_DEFINITIONS table that builds SettingsSchema, so a new setting kind
 * cannot silently become another unguarded ExtendScript input.
 *
 * A rejected value falls back to its declared default instead of aborting: the
 * desk gets the graphic plus a named warning, not a dead export.
 *
 * Mutates in place, and takes the settings bag rather than the document, because
 * the only caller hands it the object `resolveDocumentSettings` allocated one
 * line earlier and nothing else holds a reference. A clone here costs `__assign`
 * twice in a bundle that is measured in bytes.
 */
function sanitizeSettings(settings: Settings, warnings: StructuredWarning[]): void {
  for (let i = 0; i < SETTING_DEFINITIONS.length; i++) {
    const key = SETTING_DEFINITIONS[i].key;
    const value = settings[key];
    if (isValidSettingValue(key, value)) continue;
    const fallback = getSettingDefault(key);
    settings[key] = fallback as never;
    warnings.push(
      createWarning(
        "setting:invalid-value",
        "setting",
        `Setting "${key}" has an invalid value. Using "${fallback}" instead.`,
        { setting: key, surface: "illustrator" },
      ),
    );
  }
}

/**
 * The slug is a filename component, so an unsafe value is a path traversal at
 * the exporter's write site, not just a CSS-selector problem. Illustrator now
 * keyword-cases it at the source; this is the backstop for every other Zod-free
 * producer, and it runs after `sanitizeSettings` because clearing an
 * invalid `projectName` is exactly what makes grouping fall through to here.
 */
function sanitizeDocumentSlug(
  doc: { metadata: { slug?: string } },
  warnings: StructuredWarning[],
): void {
  const slug = doc.metadata.slug;
  if (typeof slug !== "string" || slug === "") return;
  if (SAFE_SETTING_IDENTIFIER_RE.test(slug)) return;
  const safe = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  doc.metadata.slug = safe || "graphic";
  warnings.push(
    createWarning(
      "setting:invalid-value",
      "setting",
      'Document slug "' +
        slug +
        '" is not a safe identifier (letters, digits, "_", "-"); it names output files, so it was replaced with "' +
        doc.metadata.slug +
        '".',
      { setting: "projectName", surface: "illustrator" },
    ),
  );
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
  // JSON sentinels are contract violations, not ordinary invalid settings.
  // Check before fallback normalization so Infinity/NaN/undefined cannot be
  // silently converted into defaults.
  assertJsonPure(resolved, "resolveSettings");
  phase("assertJsonPure:resolved");
  // Before any transform reads them: there is no Zod on this path, so a
  // metacharacter in `namespace`/`projectName` would be concatenated into CSS.
  sanitizeSettings(resolved.settings, warnings);
  // metadata.slug is not a setting, but groupArtboards falls back to it when
  // projectName is absent or was just cleared above — and the slug is
  // concatenated into output file paths. Sanitizing only the setting left
  // "../../pwn" reaching the write site through the fallback.
  sanitizeDocumentSlug(resolved, warnings);
  // The other half of the same filename: `exporter.jsx` writes
  // `outputPath + slug + extension`, so an extension of "/../../outside.txt"
  // escaped the chosen folder even with a safe slug. Normalized in place, so
  // every later reader — including the file records handed back to the exporter
  // — sees the value that was accepted rather than the one that was requested.
  resolved.settings.htmlOutputExtension = resolveOutputExtension(
    resolved.settings.htmlOutputExtension,
    warnings,
    "illustrator",
  );
  // Illustrator declares what it honors like every other surface; anything the
  // user set that the exporter will not act on warns here (SPEC 12.5).
  const capabilityWarnings = checkSurfaceCapabilities(illustratorCapabilities, resolved.settings, {
    surface: "illustrator",
    path: "render",
    format: "html",
  });
  for (let i = 0; i < capabilityWarnings.length; i++) warnings.push(capabilityWarnings[i]);
  phase("checkSurfaceCapabilities");
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
  // Already normalized and containment-checked above, so the exporter can
  // concatenate it into a path without a second rule of its own.
  const extension = ready.settings.htmlOutputExtension;
  const files: ProcessFile[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    // Illustrator's asset layout is the emitters' `assetBase` **default**, and
    // this call passes no emitter options on purpose.
    //
    // The layout: `exporter.jsx:1803-1806` computes ONE output directory —
    // `docPath + (html_output_path || image_output_path || "all2html-output/")`
    // — and writes the HTML *and* every image into it, so an image is a sibling
    // of the page that references it and the `src` prefix is empty. That is
    // exactly `assetBase: ""`, which is what `buildHTMLTree` uses when no
    // surface states one. It used to be spelled by clearing
    // `settings.imageOutputPath` before emit — a layout fact encoded by
    // mutating a user-visible setting, which also left the capability
    // declaration describing the workaround instead of the behavior.
    //
    // Why not state it anyway as `{ assetBase: "" }`: an emitter-options object
    // here is non-`undefined`, so rollup can no longer prove
    // `options.positionMode` and `options.allowUnsafeHtml` are unset, and
    // `percentage-positions.ts` plus `suppressUnsafeBindingHtml` enter the
    // shipped artifact — measured at +4,148 B (121,121 -> 125,269 B) of code no
    // Illustrator export can reach, since neither is a setting and this surface
    // has no emitter config. The statement lives in this comment, in the
    // Illustrator `imageOutputPath` capability note, and — executably, through
    // this exact entry point — in `test/integration/surface-entrypoints.test.ts`.
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

export { defaultSettings, isValidSettingValue, relativeOutputDirectory };
