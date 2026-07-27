import type {
  ArtboardBreakpoint,
  BreakpointedArtboard,
  BreakpointedDocument,
  ResolvedArtboard,
  ResolvedDocument,
} from "../ir/types.js";
import { artboardGroupKey } from "./group-artboards.js";

/**
 * Consumes a `resolved` document and produces a `breakpointed` one. The two phases are
 * distinct types, so this can be neither skipped nor run twice without a compile error
 * — which is the whole reason the phase exists (SPEC §12.1).
 *
 * Ranges are scoped to the **responsive group**, not to the document. Two artboards
 * that end up in different output files never appear on the same page, so one must not
 * cap the other's `maxWidth`: computing globally made the widest artboard of every
 * group but the last bounded above by a stranger, and where the widths matched exactly
 * it produced an empty range (`min-width: 600 / max-width: 599`) that displayed nothing
 * at all. The grouping rule itself is `artboardGroupKey` in `group-artboards.ts` — the
 * same function `groupArtboards` uses to build the files — so the early phase and the
 * late one cannot drift.
 *
 * ES3-safe: this module ships inside the ExtendScript bundle. Index loops only, no
 * `Map`/`Set`, and accumulator keys carry the `$` prefix `artboardGroupKey` applies.
 */
export function computeBreakpoints(doc: ResolvedDocument): BreakpointedDocument {
  const responsiveness = doc.settings.responsiveness;
  const artboards = doc.artboards;

  // Partition indexes by responsive group, in first-appearance order.
  const groupKeys: string[] = [];
  const groupIndexes: { [key: string]: number[] } = {};
  for (let i = 0; i < artboards.length; i++) {
    const key = artboardGroupKey(artboards[i].name, doc.settings.output);
    if (!groupIndexes[key]) {
      groupIndexes[key] = [];
      groupKeys.push(key);
    }
    groupIndexes[key].push(i);
  }

  const enriched: BreakpointedArtboard[] = [];
  for (let g = 0; g < groupKeys.length; g++) {
    const indexes = groupIndexes[groupKeys[g]].slice().sort(byIndexedWidth(artboards));
    for (let i = 0; i < indexes.length; i++) {
      const ab = artboards[indexes[i]];
      const width = ab.width;
      const abResponsiveness = ab.responsiveness ?? responsiveness;

      // Visibility range, within this group. The group's widest artboard is unbounded
      // above, which is modelled by omitting `maxWidth` entirely — never by a sentinel
      // such as Infinity, which JSON.stringify turns into null.
      const minWidth = i === 0 ? 0 : width;
      const maxWidth = i === indexes.length - 1 ? undefined : artboards[indexes[i + 1]].width - 1;

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

      enriched[indexes[i]] = { ...ab, breakpoint };
    }
  }

  // Document order stays what it has always been at this phase: every artboard sorted
  // by width, groups interleaved. `groupArtboards` re-sorts inside each group anyway,
  // and changing the order here would move markup for one-file documents too.
  const order: number[] = [];
  for (let i = 0; i < artboards.length; i++) order.push(i);
  order.sort(byIndexedWidth(artboards));

  const sorted: BreakpointedArtboard[] = [];
  for (let i = 0; i < order.length; i++) sorted.push(enriched[order[i]]);

  return { ...doc, pipelinePhase: "breakpointed", artboards: sorted };
}

function byIndexedWidth(artboards: ResolvedArtboard[]): (a: number, b: number) => number {
  return (a: number, b: number): number => artboards[a].width - artboards[b].width;
}
