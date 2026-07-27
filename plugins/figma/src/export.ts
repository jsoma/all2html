import { strToU8, zipSync } from "fflate";
import {
  assertSafeBundleEntryPath,
  createOutputBundle,
  getBrowserEmitter,
  processDocumentInBrowser,
} from "../../../src/browser.js";
import { artifactAssetBase } from "../../../src/core/artifact-path.js";
import { type EmitterConfig, withAssetBase } from "../../../src/emitters/types.js";
import type { ImportedAssetFile } from "../../../src/importers/types.js";
import type { Document } from "../../../src/ir/types.js";
import type { ExtractedAsset, FigmaOutputFormat } from "./types.js";

export interface ExportBundleEntry {
  path: string;
  content: string | Uint8Array;
}

export interface FigmaExportBundle {
  format: FigmaOutputFormat;
  ir: Document;
  entries: ExportBundleEntry[];
  warnings: string[];
}

function normalizeAssetFiles(assets: readonly ExtractedAsset[]): ImportedAssetFile[] {
  const files: ImportedAssetFile[] = [];
  for (const asset of assets) {
    if (!asset.bytes) continue;
    files.push({
      path: asset.path,
      bytes: asset.bytes,
      mimeType: asset.mimeType,
    });
  }
  return files;
}

export function buildExportBundle(
  ir: Document,
  options: {
    format: FigmaOutputFormat;
    assetFiles?: readonly ExtractedAsset[];
    /**
     * Canonical emitter options, read from the plugin config's `emit` block.
     * The CLI passes the same object into `emitAll` (`src/cli/index.ts`);
     * without it `positionMode`, `allowUnsafeHtml` and `responsiveImageMode`
     * were unreachable from Figma even though the emitters implement them.
     */
    emit?: EmitterConfig;
  },
): FigmaExportBundle {
  const {
    document,
    groups,
    warnings: pipelineWarnings,
  } = processDocumentInBrowser(ir, {
    surface: { surface: "figma", path: "render", format: options.format },
  });
  // `createOutputBundle` below writes the emitted files at the ZIP root and the
  // assets at `assetRoot + asset.path`, so the path from an emitted file to an
  // asset is exactly `assetRoot`. Stated once, used by both sides.
  const assetRoot = artifactAssetBase(document.settings.imageOutputPath || "");
  const emitted = getBrowserEmitter(options.format).emitAll(
    document,
    groups,
    withAssetBase(options.emit, assetRoot),
  );
  const warnings = [...pipelineWarnings, ...emitted.warnings];
  const bundle = createOutputBundle({
    irDocument: ir,
    emittedFiles: emitted.files,
    assetFiles: normalizeAssetFiles(options.assetFiles ?? []),
    // Asset records carry paths relative to the image output directory, so the
    // bundle layout re-applies the same directory the emitted `src` attributes
    // got through `assetBase`. Omitting it is what made a non-default
    // `imageOutputPath` produce HTML pointing outside the ZIP.
    assetRoot,
    emittedFormat: options.format,
    warnings,
  });

  return {
    format: options.format,
    ir,
    entries: bundle.files.map((file) => ({
      path: file.path,
      content: file.text ?? file.bytes,
    })),
    warnings,
  };
}

/**
 * This is the sink that actually ships a ZIP to a machine — the user downloads
 * it from the plugin and extracts it — and it builds its entry names from
 * `FigmaExportBundle.entries` rather than calling `bundleToZipBytes()`, so the
 * containment `createOutputBundle()` enforces at construction is re-asserted
 * here. Same relationship as `resolveInsideOutputDir()` on the CLI: one rule,
 * stated where the paths are built, backstopped at the write.
 */
export function createZipArchive(bundle: FigmaExportBundle): Uint8Array {
  const zipEntries: Record<string, Uint8Array> = {};
  for (const entry of bundle.entries) {
    zipEntries[assertSafeBundleEntryPath(entry.path)] =
      typeof entry.content === "string" ? strToU8(entry.content) : new Uint8Array(entry.content);
  }
  return zipSync(zipEntries, { level: 0 });
}
