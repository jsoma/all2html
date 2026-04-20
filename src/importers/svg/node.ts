import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { unzipSync } from "fflate";
import type { ImportedFile } from "../types.js";
import { importSVGFilesWithRasterizer, type SVGImportOptions } from "./import-core.js";
import { type LoadedSVGImportFiles, normalizeSVGImportPath } from "./loaded.js";
import type { SvgRasterizer } from "./rasterizer.js";

export { createNodeSvgRasterizer } from "./rasterizer-node.js";

function normalizePath(path: string): string {
  return normalizeSVGImportPath(path);
}

function walkDirectory(rootDir: string): string[] {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDirectory(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

function readDirectoryFiles(rootDir: string): ImportedFile[] {
  const files = walkDirectory(rootDir).sort((a, b) => a.localeCompare(b));
  return files.map((fullPath) => {
    const relPath = normalizePath(relative(rootDir, fullPath));
    const bytes = readFileSync(fullPath);
    const isSvg = extname(fullPath).toLowerCase() === ".svg";
    return {
      path: relPath,
      content: isSvg ? bytes.toString("utf-8") : new Uint8Array(bytes),
    };
  });
}

export function loadSVGImportFiles(inputPath: string): LoadedSVGImportFiles {
  const resolvedInput = resolve(inputPath);
  const stat = statSync(resolvedInput);

  if (stat.isDirectory()) {
    const files = readDirectoryFiles(resolvedInput);
    const entrypointPaths = files
      .filter((file) => file.path.toLowerCase().endsWith(".svg"))
      .map((file) => file.path);
    return {
      files,
      entrypointPaths,
      slug: basename(resolvedInput),
    };
  }

  const extension = extname(resolvedInput).toLowerCase();

  if (extension === ".zip") {
    const archive = unzipSync(readFileSync(resolvedInput));
    const files: ImportedFile[] = Object.entries(archive)
      .filter(([path]) => !path.endsWith("/") && !path.startsWith("__MACOSX/"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, bytes]) => {
        const normalized = normalizePath(path);
        const isSvg = normalized.toLowerCase().endsWith(".svg");
        return {
          path: normalized,
          content: isSvg ? new TextDecoder().decode(bytes) : bytes,
        };
      });

    return {
      files,
      entrypointPaths: files
        .filter((file) => file.path.toLowerCase().endsWith(".svg"))
        .map((file) => file.path),
      slug: basename(resolvedInput, ".zip"),
    };
  }

  if (extension === ".svg") {
    const rootDir = dirname(resolvedInput);
    const files = readDirectoryFiles(rootDir);
    const entrypointPath = normalizePath(relative(rootDir, resolvedInput));
    return {
      files,
      entrypointPaths: [entrypointPath],
      slug: basename(resolvedInput, ".svg"),
    };
  }

  throw new Error(`Unsupported SVG import input: ${inputPath}`);
}

export async function importSVGFilesFromNode(
  files: readonly ImportedFile[],
  options: Omit<SVGImportOptions, "rasterizer"> & { rasterizer?: SvgRasterizer } = {},
) {
  const { createNodeSvgRasterizer } = await import("./rasterizer-node.js");
  return importSVGFilesWithRasterizer(files, {
    ...options,
    rasterizer: options.rasterizer ?? createNodeSvgRasterizer(),
  });
}
