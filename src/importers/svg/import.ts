import type { ImportedFile, ImportResult } from "../types.js";
import { importSVGFilesWithRasterizer, type SVGImportOptions } from "./import-core.js";
import type { SvgRasterizer } from "./rasterizer.js";

export { importSVGFilesWithRasterizer, type SVGImportOptions } from "./import-core.js";

export async function importSVGFiles(
  files: readonly ImportedFile[],
  options: Omit<SVGImportOptions, "rasterizer"> & { rasterizer?: SvgRasterizer } = {},
): Promise<ImportResult> {
  const rasterizer = options.rasterizer ?? (await loadDefaultRasterizer());
  return importSVGFilesWithRasterizer(files, {
    ...options,
    rasterizer,
  });
}

async function loadDefaultRasterizer(): Promise<SvgRasterizer> {
  try {
    const { createNodeSvgRasterizer } = await import("./rasterizer-node.js");
    return createNodeSvgRasterizer();
  } catch (error) {
    const reason = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(
      `No SVG rasterizer was provided and the default Node rasterizer could not be loaded.${reason}`,
    );
  }
}
