import { strToU8, zipSync } from "fflate";
import {
  createOutputBundle,
  getBrowserEmitter,
  processDocumentInBrowser,
} from "../../../src/browser.js";
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
  },
): FigmaExportBundle {
  const {
    document,
    groups,
    warnings: pipelineWarnings,
  } = processDocumentInBrowser(ir, {
    surface: { surface: "figma", path: "render", format: options.format },
  });
  const emitted = getBrowserEmitter(options.format).emitAll(document, groups);
  const warnings = [...pipelineWarnings, ...emitted.warnings];
  const bundle = createOutputBundle({
    irDocument: ir,
    emittedFiles: emitted.files,
    assetFiles: normalizeAssetFiles(options.assetFiles ?? []),
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

export function createZipArchive(bundle: FigmaExportBundle): Uint8Array {
  const zipEntries: Record<string, Uint8Array> = {};
  for (const entry of bundle.entries) {
    zipEntries[entry.path] =
      typeof entry.content === "string" ? strToU8(entry.content) : new Uint8Array(entry.content);
  }
  return zipSync(zipEntries, { level: 0 });
}
