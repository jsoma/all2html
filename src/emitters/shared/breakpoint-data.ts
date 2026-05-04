import type { EmitterReadyDocument } from "../../ir/types.js";
import { makeArtboardKey } from "./css.js";

export interface BreakpointEntry {
  artboardId: string;
  artboardName: string;
  minWidth: number;
  maxWidth: number;
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
    .map((ab) => ({
      artboardId: `${ns}${slug}-${makeArtboardKey(ab, doc.artboards)}`,
      artboardName: ab.name,
      minWidth: ab.breakpoint.minWidth,
      maxWidth:
        ab.breakpoint.maxWidth === Number.POSITIVE_INFINITY ? 99999 : ab.breakpoint.maxWidth,
    }));
}
