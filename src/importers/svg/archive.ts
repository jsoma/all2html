import { unzipSync } from "fflate";
import type { ImportedFile } from "../types.js";
import { type LoadedSVGImportFiles, normalizeSVGImportPath } from "./loaded.js";

/**
 * One ZIP input loader for both SVG import surfaces.
 *
 * `node.ts` and `browser.ts` used to carry the same unzip algorithm twice
 * (identical retention filter, sort, and decode). The two surface-specific
 * bits — slug derivation and MIME inference — come in through `options`;
 * everything else lives here once.
 *
 * Path policy is unchanged on purpose: hostile entry names never drive
 * filesystem reads (the importer resolves through an in-memory map), and
 * output paths are regenerated downstream through `artifact-path.ts` +
 * `resolveInsideOutputDir`. The only normalization is the existing
 * `normalizeSVGImportPath`.
 */

export const MAX_SVG_ARCHIVE_ENTRIES = 2000;
export const MAX_SVG_ARCHIVE_EXPANDED_BYTES = 256 * 1024 * 1024; // 256 MiB

export interface SVGArchiveLimits {
  maxEntries: number;
  maxExpandedBytes: number;
}

export interface SVGArchiveLoadOptions {
  /** Slug for the loaded set; each surface derives it from its own input name. */
  slug: string;
  /** Surface-specific MIME inference. Omitted means no `mimeType` (Node behavior). */
  inferMimeType?: (normalizedPath: string) => string | undefined;
  /** Test seam only — production callers use the exported defaults. */
  limits?: Partial<SVGArchiveLimits>;
}

/** Directories and macOS resource-fork noise are never retained. */
function isRetainedArchiveEntry(name: string): boolean {
  return !name.endsWith("/") && !name.startsWith("__MACOSX/");
}

export function loadSVGImportFilesFromArchive(
  archiveBytes: Uint8Array,
  options: SVGArchiveLoadOptions,
): LoadedSVGImportFiles {
  const maxEntries = options.limits?.maxEntries ?? MAX_SVG_ARCHIVE_ENTRIES;
  const maxExpandedBytes = options.limits?.maxExpandedBytes ?? MAX_SVG_ARCHIVE_EXPANDED_BYTES;

  // Pass 1: metadata only. The filter always returns false, so fflate walks the
  // archive's headers without inflating a single entry — both caps are checked
  // against declared sizes before any decompressed content is retained.
  let entryCount = 0;
  let declaredExpandedBytes = 0;
  unzipSync(archiveBytes, {
    filter(info) {
      if (!isRetainedArchiveEntry(info.name)) {
        return false;
      }
      entryCount += 1;
      if (entryCount > maxEntries) {
        throw new Error(
          `ZIP archive has too many entries: SVG import accepts at most ${maxEntries} files per archive.`,
        );
      }
      declaredExpandedBytes += info.originalSize;
      if (declaredExpandedBytes > maxExpandedBytes) {
        throw new Error(
          `ZIP archive is too large: entries expand past the ${formatMiB(maxExpandedBytes)} MiB limit for SVG import.`,
        );
      }
      return false;
    },
  });

  // Pass 2: extraction, same retention rule.
  const archive = unzipSync(archiveBytes, {
    filter: (info) => isRetainedArchiveEntry(info.name),
  });

  const files: ImportedFile[] = Object.entries(archive)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, bytes]) => {
      const normalized = normalizeSVGImportPath(path);
      const isSvg = normalized.toLowerCase().endsWith(".svg");
      const mimeType = options.inferMimeType?.(normalized);
      return {
        path: normalized,
        content: isSvg ? new TextDecoder().decode(bytes) : bytes,
        ...(mimeType === undefined ? {} : { mimeType }),
      };
    });

  const entrypointPaths = files
    .filter((file) => file.path.toLowerCase().endsWith(".svg"))
    .map((file) => file.path);

  if (entrypointPaths.length === 0) {
    throw new Error(
      "ZIP archive contains no .svg entries. SVG import needs at least one SVG file in the archive.",
    );
  }

  return {
    files,
    entrypointPaths,
    slug: options.slug,
  };
}

function formatMiB(bytes: number): string {
  return String(Math.round(bytes / (1024 * 1024)));
}
