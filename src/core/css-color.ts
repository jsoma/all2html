/**
 * The one CSS color formatter (spec §2.3). Replaces three module-private
 * formatters (compute-positions, compute-styles, deduplicate-styles) and two
 * inline `rgb(...)` builders in the HTML emitter, which had three different
 * behaviors — two of them silently dropped alpha, and the dedup key spelled the
 * same color differently from the emitted style (`.toFixed(2)` vs `round`).
 *
 * ES5-safe: this module rides into the ExtendScript bundle. No template
 * literals beyond what the transpiler lowers, no ES2015+ runtime APIs.
 */

import type { Color } from "../ir/types.js";

/**
 * ai2html **text** parity: a run color with every channel below this snaps to
 * pure black. Scoped to character-run color only (`formatCssColorSnapNearBlack`)
 * — fills, strokes, `areaFill` and `areaBorder` must NOT snap, or dark-gray
 * shapes would silently render pure black.
 */
const RGB_BLACK_THRESHOLD = 36;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Format a color for CSS: `rgba(r,g,b,a)` when the color carries an opacity
 * below 100 (IR opacity is 0-100; alpha is rounded to 2 decimals with trailing
 * zeros dropped — `0.5`, not `0.50`), `rgb(r,g,b)` otherwise.
 */
export function formatCssColor(color: Color): string {
  const opacity = color.opacity;
  if (opacity !== undefined && opacity !== null && opacity < 100) {
    return "rgba(" + color.r + "," + color.g + "," + color.b + "," + round2(opacity / 100) + ")";
  }
  return "rgb(" + color.r + "," + color.g + "," + color.b + ")";
}

/**
 * Character-run variant: same formatting, plus the ai2html near-black snap.
 * The only legitimate caller is text-run color in `compute-styles.ts`.
 */
export function formatCssColorSnapNearBlack(color: Color): string {
  if (
    color.r < RGB_BLACK_THRESHOLD &&
    color.g < RGB_BLACK_THRESHOLD &&
    color.b < RGB_BLACK_THRESHOLD
  ) {
    const snapped: Color = { r: 0, g: 0, b: 0 };
    if (color.opacity !== undefined) snapped.opacity = color.opacity;
    return formatCssColor(snapped);
  }
  return formatCssColor(color);
}
