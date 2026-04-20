/// <reference lib="dom" />

import { unzipSync } from "fflate";
import type { ImportedFile } from "../types.js";
import { type LoadedSVGImportFiles, normalizeSVGImportPath } from "./loaded.js";

export async function loadSVGImportFilesFromBrowser(
  input: Iterable<File> | FileList,
): Promise<LoadedSVGImportFiles> {
  const files = Array.from(input);
  if (files.length === 0) {
    throw new Error("No files were provided for SVG import.");
  }

  if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
    const archiveBytes = new Uint8Array(await files[0].arrayBuffer());
    const archive = unzipSync(archiveBytes);
    const imported: ImportedFile[] = Object.entries(archive)
      .filter(([path]) => !path.endsWith("/") && !path.startsWith("__MACOSX/"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, bytes]) => {
        const normalized = normalizeSVGImportPath(path);
        const isSvg = normalized.toLowerCase().endsWith(".svg");
        return {
          path: normalized,
          content: isSvg ? new TextDecoder().decode(bytes) : bytes,
          mimeType: inferBrowserMimeType(normalized),
        };
      });
    return {
      files: imported,
      entrypointPaths: imported
        .filter((file) => file.path.toLowerCase().endsWith(".svg"))
        .map((file) => file.path),
      slug: stripExtension(files[0].name),
    };
  }

  const imported = await Promise.all(
    files.map(async (file) => {
      const path = normalizeSVGImportPath(getBrowserImportPath(file));
      const isSvg = path.toLowerCase().endsWith(".svg");
      return {
        path,
        content: isSvg ? await file.text() : new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type || inferBrowserMimeType(path),
      } satisfies ImportedFile;
    }),
  );

  const sorted = imported.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: sorted,
    entrypointPaths: sorted
      .filter((file) => file.path.toLowerCase().endsWith(".svg"))
      .map((file) => file.path),
    slug: deriveBrowserSlug(files, sorted),
  };
}

function getBrowserImportPath(file: File): string {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return path && path.length > 0 ? path : file.name;
}

function deriveBrowserSlug(
  originalFiles: readonly File[],
  importedFiles: readonly ImportedFile[],
): string {
  const importedPathsWithDirectories = importedFiles
    .map((file) => file.path)
    .filter((path) => path.includes("/"));
  if (importedPathsWithDirectories.length > 0) {
    const firstSegments = new Set(importedPathsWithDirectories.map((path) => path.split("/")[0]));
    if (firstSegments.size === 1) {
      return Array.from(firstSegments)[0];
    }
  }

  if (originalFiles.length === 1 && originalFiles[0].name.toLowerCase().endsWith(".svg")) {
    return stripExtension(originalFiles[0].name);
  }

  if (importedFiles.length === 1 && importedFiles[0].path.toLowerCase().endsWith(".svg")) {
    return stripExtension(importedFiles[0].path.split("/").pop() || "svg-import");
  }

  return "svg-import";
}

function stripExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(0, dot) : path;
}

function inferBrowserMimeType(path: string): string | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".json")) return "application/json";
  return undefined;
}
