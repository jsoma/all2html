import type { EmitterReadyDocument } from "../../ir/types.js";
import { makeArtboardKey } from "./css.js";

export interface BreakpointEntry {
  artboardId: string;
  artboardName: string;
  minWidth: number;
  /**
   * Upper bound, inclusive. **Omitted** for the widest artboard, which is unbounded
   * above — the same "absence means unbounded" model the document uses (see
   * `IR types.ts`, decision D21). Deliberately not a sentinel: a `99999` here is a
   * real upper bound to any consumer doing `minWidth <= w <= maxWidth`, so a
   * 120000px artboard or a 100000px container would match no entry at all. Use
   * `isBreakpointActive()` rather than reading the field directly.
   */
  maxWidth?: number;
}

/**
 * True when `width` falls inside the entry's range. An absent `maxWidth` is
 * unbounded above, so the widest artboard always matches at large widths.
 */
export function isBreakpointActive(entry: BreakpointEntry, width: number): boolean {
  if (width < entry.minWidth) return false;
  return entry.maxWidth === undefined || width <= entry.maxWidth;
}

/** The entry active at `width`, or `undefined` if the list is empty. */
export function findActiveBreakpoint(
  entries: BreakpointEntry[],
  width: number,
): BreakpointEntry | undefined {
  for (let i = 0; i < entries.length; i++) {
    if (isBreakpointActive(entries[i], width)) return entries[i];
  }
  return undefined;
}

/**
 * Extract breakpoint data from a document for runtime artboard change detection.
 * Serialized into generated Svelte/React components as a const array.
 * Values match the CSS container query breakpoints for JS↔CSS consistency.
 */
export function extractBreakpointData(doc: EmitterReadyDocument): BreakpointEntry[] {
  const ns = doc.settings.namespace;
  const slug = doc.settings.projectName || doc.metadata.slug;

  return [...doc.artboards]
    .sort((a, b) => a.breakpoint.minWidth - b.breakpoint.minWidth)
    .map((ab) => {
      const entry: BreakpointEntry = {
        artboardId: `${ns}${slug}-${makeArtboardKey(ab, doc.artboards)}`,
        artboardName: ab.name,
        minWidth: ab.breakpoint.minWidth,
      };
      // Absence is carried through, not translated into a number.
      if (ab.breakpoint.maxWidth !== undefined) entry.maxWidth = ab.breakpoint.maxWidth;
      return entry;
    });
}
