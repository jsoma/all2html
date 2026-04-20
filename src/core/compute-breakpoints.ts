import type { ArtboardBreakpoint, ResolvedArtboard, ResolvedDocument } from "../ir/types.js";

export function computeBreakpoints(doc: ResolvedDocument): ResolvedDocument {
  const responsiveness = doc.settings.responsiveness;
  const sorted = [...doc.artboards].sort((a, b) => a.width - b.width);

  const enriched: ResolvedArtboard[] = sorted.map((ab, i) => {
    const width = ab.width;
    const abResponsiveness = ab.responsiveness ?? responsiveness;

    // Visibility range
    const minWidth = i === 0 ? 0 : width;
    const maxWidth = i === sorted.length - 1 ? Infinity : sorted[i + 1].width - 1;

    // Width range (for sizing)
    let widthRangeMin: number;
    let widthRangeMax: number;
    if (abResponsiveness === "dynamic") {
      widthRangeMin = minWidth;
      widthRangeMax = maxWidth;
    } else {
      widthRangeMin = i === 0 ? 0 : width;
      widthRangeMax = width;
    }

    const breakpoint: ArtboardBreakpoint = {
      minWidth,
      maxWidth,
      widthRangeMin,
      widthRangeMax,
    };

    return { ...ab, breakpoint };
  });

  return { ...doc, artboards: enriched };
}
