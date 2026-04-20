import { makeKeyword } from "../emitters/shared/css.js";
import type { EmitterReadyArtboard, EmitterReadyDocument } from "../ir/types.js";

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
      if (!groups.has(baseName)) {
        groups.set(baseName, []);
      }
      groups.get(baseName)!.push(ab);
    }

    const result: ArtboardGroup[] = [];
    groups.forEach((artboards, name) => {
      result.push({
        name,
        slug: slug + "-" + makeKeyword(name),
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
