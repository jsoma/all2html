import type {
  ArtboardBreakpoint,
  BreakpointedArtboard,
  BreakpointedDocument,
  ResolvedDocument,
} from "../ir/types.js";

/**
 * Consumes a `resolved` document and produces a `breakpointed` one. The two phases are
 * distinct types, so this can be neither skipped nor run twice without a compile error
 * — which is the whole reason the phase exists (SPEC §12.1).
 */
export function computeBreakpoints(doc: ResolvedDocument): BreakpointedDocument {
  const responsiveness = doc.settings.responsiveness;
  const sorted = [...doc.artboards].sort((a, b) => a.width - b.width);

  const enriched: BreakpointedArtboard[] = sorted.map((ab, i) => {
    const width = ab.width;
    const abResponsiveness = ab.responsiveness ?? responsiveness;

    // Visibility range. The widest artboard is unbounded above, which is modelled by
    // omitting `maxWidth` entirely — never by a sentinel such as Infinity, which
    // JSON.stringify turns into null.
    const minWidth = i === 0 ? 0 : width;
    const maxWidth = i === sorted.length - 1 ? undefined : sorted[i + 1].width - 1;

    // Width range (for sizing)
    let widthRangeMin: number;
    let widthRangeMax: number | undefined;
    if (abResponsiveness === "dynamic") {
      widthRangeMin = minWidth;
      widthRangeMax = maxWidth;
    } else {
      widthRangeMin = i === 0 ? 0 : width;
      widthRangeMax = width;
    }

    const breakpoint: ArtboardBreakpoint = {
      minWidth,
      widthRangeMin,
    };
    if (maxWidth !== undefined) breakpoint.maxWidth = maxWidth;
    if (widthRangeMax !== undefined) breakpoint.widthRangeMax = widthRangeMax;

    return { ...ab, breakpoint };
  });

  return { ...doc, pipelinePhase: "breakpointed", artboards: enriched };
}
