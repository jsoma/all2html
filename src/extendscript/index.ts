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
import { assertJsonPure } from "../core/json-purity.js";
import { resolveSettingsPure } from "../core/resolve-settings-pure.js";
import { type StructuredWarning, warningMessages } from "../core/warnings.js";
import { emitHTMLString } from "../emitters/html-string.js";
import { defaultSettings } from "../ir/defaults.js";
import type { Document, FontMapping, Settings } from "../ir/types.js";
import { installPolyfills } from "./polyfills.js";

// Install polyfills on load
installPolyfills();

export interface ProcessResult {
  html: string;
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
  const { html, structuredWarnings: emitWarnings } = emitHTMLString(ready);
  warnings.push(...emitWarnings);
  phase("emitHTMLString");

  return { html, warnings: warningMessages(warnings), structuredWarnings: warnings };
}

export { defaultSettings };
