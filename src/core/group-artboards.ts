import type { EmitterReadyArtboard, EmitterReadyDocument, Settings } from "../ir/types.js";
import { makeKeyword } from "./identifiers.js";

export interface ArtboardGroup {
  name: string;
  slug: string;
  artboards: EmitterReadyArtboard[];
}

/**
 * The single definition of "which artboards belong to the same responsive
 * group", shared by `groupArtboards` (which turns groups into output files) and
 * `computeBreakpoints` (which sizes each group's width ranges).
 *
 * The two have to agree and they run at opposite ends of the pipeline —
 * breakpoints early, grouping last — so the rule lives here rather than being
 * spelled twice. When they disagreed, breakpoint ranges were computed across
 * *every* artboard in the document while each output file only contained one
 * group, so artboards that never appear together constrained each other:
 * `multiple-files-test-artboard-2.html` emitted `data-min-width="600"
 * data-max-width="599"` — an empty range — because a same-width artboard in the
 * *other* file capped it.
 *
 * In `one-file` mode every artboard is one group, which is the pre-existing
 * behavior. The returned string is an accumulator key, not a display name: it
 * carries the `$` prefix (the same guard `makeArtboardKey` uses) because
 * artboard names are user text and an artboard named `__proto__`,
 * `constructor` or `toString` would otherwise read a value off
 * `Object.prototype` instead of an absent slot.
 */
export function artboardGroupKey(artboardName: string, output: Settings["output"]): string {
  return output === "multiple-files" ? `$${artboardName}` : "$";
}

/**
 * Group artboards for output.
 * - "one-file": all artboards in a single group named after the document
 * - "multiple-files": group by base name (artboards with the same name form responsive groups)
 *
 * ES3-safe on purpose. This module is in the ExtendScript entry graph now that
 * `src/extendscript/index.ts` calls it (KB1: `output: "multiple-files"` used to
 * be a no-op on Illustrator precisely because the two `new Map`s here are banned
 * by the bundle guard). So: no `Map`, no `Set`, no `for...of`, no spread.
 *
 * Group order and slug-collision numbering both follow **first-appearance order**
 * of the artboards, which is what the `Map` insertion order gave before. That
 * order is carried in an explicit array rather than read back out of the
 * accumulator object: ES3 leaves `for...in` order unspecified, and ExtendScript's
 * `Object.keys` is a `for...in` polyfill.
 *
 * Accumulator keys are user-supplied artboard names, so they are prefixed with
 * `$` (the same guard `makeArtboardKey` uses) — an artboard named `__proto__`,
 * `constructor` or `toString` would otherwise read a value off `Object.prototype`
 * instead of an absent slot.
 */
export function groupArtboards(doc: EmitterReadyDocument): ArtboardGroup[] {
  const outputMode = doc.settings.output;
  const slug = doc.settings.projectName || doc.metadata.slug;

  if (outputMode === "multiple-files") {
    const groupNames: string[] = [];
    const byName: Record<string, EmitterReadyArtboard[]> = {};
    for (let i = 0; i < doc.artboards.length; i++) {
      const ab = doc.artboards[i];
      const nameKey = artboardGroupKey(ab.name, outputMode);
      if (!byName[nameKey]) {
        byName[nameKey] = [];
        groupNames.push(ab.name);
      }
      byName[nameKey].push(ab);
    }

    const result: ArtboardGroup[] = [];
    const usedSlugs: Record<string, number> = {};
    for (let i = 0; i < groupNames.length; i++) {
      const name = groupNames[i];
      const baseSlug = `${slug}-${makeKeyword(name, "artboard")}`;
      const slugKey = `$${baseSlug}`;
      const nextCount = (usedSlugs[slugKey] || 0) + 1;
      usedSlugs[slugKey] = nextCount;
      result.push({
        name,
        slug: nextCount === 1 ? baseSlug : `${baseSlug}-${nextCount}`,
        artboards: byName[artboardGroupKey(name, outputMode)].sort(byWidth),
      });
    }
    return result;
  }

  // one-file: all artboards in one group
  return [
    {
      name: slug,
      slug,
      artboards: doc.artboards.slice().sort(byBreakpoint),
    },
  ];
}

function byWidth(a: EmitterReadyArtboard, b: EmitterReadyArtboard): number {
  return a.width - b.width;
}

function byBreakpoint(a: EmitterReadyArtboard, b: EmitterReadyArtboard): number {
  return a.breakpoint.minWidth - b.breakpoint.minWidth;
}
