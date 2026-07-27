import type {
  ArtboardBreakpoint,
  BreakpointedArtboard,
  BreakpointedDocument,
  ResolvedArtboard,
  ResolvedDocument,
  Settings,
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
 * Widths must be unique **within** a group, and that is enforced here rather than
 * assumed — see `assertUniqueWidthsInGroup`.
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
    assertUniqueWidthsInGroup(artboards, indexes, doc.settings.output);
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

/**
 * Two artboards in one responsive group cannot share a width, and this fails the
 * export rather than guessing.
 *
 * The ranges below are derived purely from the *order* of the sorted widths, so
 * equal widths made the answer depend on where the artboards happened to sit in
 * `doc.artboards`: two 600px variants got `0–599` and `600–∞`, and which one
 * became the phone layout was decided by array order. The output is a plausible
 * page in which one variant is unreachable at every real viewport — wrong in a
 * way nobody sees until it is published.
 *
 * Throwing, rather than warning and picking a winner:
 *
 *  - It is the declared contract. `plugins/figma/src/extract/frames.ts` already
 *    throws on exactly this ("Responsive Figma variants ... must have unique
 *    widths"), and CLAUDE.md's Figma rule states it as a hard error. Enforcing it
 *    in one exporter and guessing in the others is the drift the shared core
 *    exists to prevent, so the rule moves here and every surface inherits it.
 *  - There is no correct fallback to warn *about*. Any tie-break — array order,
 *    name, id — is equally arbitrary, so a warning would still ship a graphic
 *    whose responsive behavior is a coin flip.
 *  - The repo's standing rule for this shape of choice ("a surface must not
 *    accept a setting it does not honor; silently ignoring a value is worse than
 *    rejecting it") points the same way.
 *
 * The cost of throwing is a failed export, so the message has to be one a desk
 * can act on without reading code: which artboards, which width, and the two
 * ways out.
 */
function assertUniqueWidthsInGroup(
  artboards: ResolvedArtboard[],
  indexes: number[],
  output: Settings["output"],
): void {
  for (let i = 1; i < indexes.length; i++) {
    const previous = artboards[indexes[i - 1]];
    const current = artboards[indexes[i]];
    if (previous.width !== current.width) continue;

    const pair = `${describeArtboard(previous)} and ${describeArtboard(current)}`;
    if (output === "multiple-files") {
      // Group membership *is* the name here, so both artboards carry it.
      throw new Error(
        `Responsive artboards named "${current.name}" must have unique widths. ` +
          `Found duplicate width ${current.width}: ${pair}. ` +
          "Give one of them a different width, or rename one so it forms its own responsive group.",
      );
    }
    throw new Error(
      "Artboards on a single page must have unique widths. " +
        `Found duplicate width ${current.width}: ${pair}. ` +
        "Give one of them a different width, or give them different names and set " +
        '"output" to "multiple-files" so they become separate files.',
    );
  }
}

function describeArtboard(artboard: ResolvedArtboard): string {
  // Name for the person, id for the case where the names are identical.
  return `"${artboard.name}" (${artboard.id})`;
}

function byIndexedWidth(artboards: ResolvedArtboard[]): (a: number, b: number) => number {
  return (a: number, b: number): number => artboards[a].width - artboards[b].width;
}
