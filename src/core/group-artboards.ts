import type { EmitterReadyArtboard, EmitterReadyDocument } from "../ir/types.js";
import { makeKeyword } from "./identifiers.js";

export interface ArtboardGroup {
  name: string;
  slug: string;
  artboards: EmitterReadyArtboard[];
}

/**
 * Group artboards for output.
 * - "one-file": all artboards in a single group named after the document
 * - "multiple-files": group by base name (artboards with the same name form responsive groups)
 */
export function groupArtboards(doc: EmitterReadyDocument): ArtboardGroup[] {
  const outputMode = doc.settings.output;
  const slug = doc.settings.projectName || doc.metadata.slug;

  if (outputMode === "multiple-files") {
    const groups = new Map<string, EmitterReadyArtboard[]>();
    for (const ab of doc.artboards) {
      const baseName = ab.name;
      const artboards = groups.get(baseName) ?? [];
      artboards.push(ab);
      groups.set(baseName, artboards);
    }

    const result: ArtboardGroup[] = [];
    const usedSlugs = new Map<string, number>();
    groups.forEach((artboards, name) => {
      const baseSlug = `${slug}-${makeKeyword(name, "artboard")}`;
      const nextCount = (usedSlugs.get(baseSlug) ?? 0) + 1;
      usedSlugs.set(baseSlug, nextCount);
      result.push({
        name,
        slug: nextCount === 1 ? baseSlug : `${baseSlug}-${nextCount}`,
        artboards: artboards.sort((a, b) => a.width - b.width),
      });
    });
    return result;
  }

  // one-file: all artboards in one group
  return [
    {
      name: slug,
      slug,
      artboards: [...doc.artboards].sort((a, b) => a.breakpoint.minWidth - b.breakpoint.minWidth),
    },
  ];
}
