/**
 * ExtendScript bundle entry point.
 * Exports the core pipeline as a single processAndEmit() function
 * that can be called from the Illustrator ExtendScript exporter.
 */

import { computeBreakpoints } from "../core/compute-breakpoints.js";
import { computePositions } from "../core/compute-positions.js";
import { computeStyles } from "../core/compute-styles.js";
import { deduplicateStyles } from "../core/deduplicate-styles.js";
import { resolveSettingsPure } from "../core/resolve-settings-pure.js";
import { emitHTMLString } from "../emitters/html-string.js";
import { defaultSettings } from "../ir/defaults.js";
import type { Document, FontMapping, Settings } from "../ir/types.js";
import { installPolyfills } from "./polyfills.js";

// Install polyfills on load
installPolyfills();

export interface ProcessResult {
  html: string;
  warnings: string[];
}

/**
 * Process an IR document and emit HTML.
 * This is the main API called by design tool exporters.
 */
export function processAndEmit(
  irDoc: Document,
  config?: { fonts?: FontMapping[]; settings?: Partial<Settings> },
): ProcessResult {
  const warnings: string[] = [];

  const resolved = resolveSettingsPure(irDoc, config);
  const withBreakpoints = computeBreakpoints(resolved);
  const { document: styled, warnings: styleWarnings } = computeStyles(withBreakpoints);
  warnings.push(...styleWarnings);
  const deduped = deduplicateStyles(styled);
  const ready = computePositions(deduped);
  const { html, warnings: emitWarnings } = emitHTMLString(ready);
  warnings.push(...emitWarnings);

  return { html, warnings };
}

export { defaultSettings };
