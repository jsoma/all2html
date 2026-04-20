import { strToU8, zipSync } from "fflate";
import { computeBreakpoints } from "../../../src/core/compute-breakpoints.js";
import { computePositions } from "../../../src/core/compute-positions.js";
import { computeStyles } from "../../../src/core/compute-styles.js";
import { deduplicateStyles } from "../../../src/core/deduplicate-styles.js";
import { groupArtboards } from "../../../src/core/group-artboards.js";
import { resolveSettingsPure } from "../../../src/core/resolve-settings-pure.js";
import { emitHTML } from "../../../src/emitters/html.js";
import type { EmitFile } from "../../../src/emitters/registry.js";
import { escapeHtml } from "../../../src/emitters/shared/hast-helpers.js";
import type { Document } from "../../../src/ir/types.js";
import { loadAndValidateIR } from "../../../src/ir/validate.js";
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

function normalizeAssetEntries(assets: readonly ExtractedAsset[]): ExportBundleEntry[] {
  return assets
    .filter((asset) => asset.bytes)
    .map((asset) => ({
      path: asset.path,
      content: asset.bytes!,
    }));
}

function processDocumentForPlugin(ir: Document) {
  const raw = loadAndValidateIR(ir);
  const resolved = resolveSettingsPure(raw);
  const withBreakpoints = computeBreakpoints(resolved);
  const { document: styled, warnings } = computeStyles(withBreakpoints);
  const deduped = deduplicateStyles(styled);
  const ready = computePositions(deduped);
  const groups = groupArtboards(ready);
  return { document: ready, groups, warnings };
}

function emitHtmlFiles(
  doc: ReturnType<typeof processDocumentForPlugin>["document"],
  groups: ReturnType<typeof processDocumentForPlugin>["groups"],
): { files: EmitFile[]; warnings: string[] } {
  const extension = doc.settings.htmlOutputExtension || ".html";
  const files: EmitFile[] = [];
  const warnings: string[] = [];

  for (const group of groups) {
    const result = emitHTML(doc, { artboards: group.artboards, slug: group.slug });
    files.push({ slug: group.slug, extension, output: result.html });
    warnings.push(...result.warnings);
  }

  return { files, warnings };
}

function emitStandaloneFile(doc: ReturnType<typeof processDocumentForPlugin>["document"]): { file: EmitFile; warnings: string[] } {
  const { html: fragment, warnings } = emitHTML(doc);
  const title = doc.metadata.headline || doc.settings.projectName || doc.metadata.slug;
  const extraWarnings = [...warnings];

  if (doc.settings.localPreviewTemplate) {
    extraWarnings.push("Standalone export in the Figma plugin ignores localPreviewTemplate.");
  }

  const output = `<!DOCTYPE html>
<html lang="${escapeHtml(doc.metadata.lang || "en")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body>
${fragment}
</body>
</html>`;

  return {
    file: {
      slug: doc.settings.projectName || doc.metadata.slug,
      extension: ".html",
      output,
    },
    warnings: extraWarnings,
  };
}

export function buildExportBundle(
  ir: Document,
  options: {
    format: FigmaOutputFormat;
    assetFiles?: readonly ExtractedAsset[];
  },
): FigmaExportBundle {
  const { document, groups, warnings: pipelineWarnings } = processDocumentForPlugin(ir);
  const emitted =
    options.format === "standalone"
      ? (() => {
          const standalone = emitStandaloneFile(document);
          return { files: [standalone.file], warnings: standalone.warnings };
        })()
      : emitHtmlFiles(document, groups);

  const entries: ExportBundleEntry[] = [
    { path: "ir.json", content: JSON.stringify(ir, null, 2) + "\n" },
    ...emitted.files.map((file) => ({
      path: `${file.slug}${file.extension}`,
      content: file.output,
    })),
    ...normalizeAssetEntries(options.assetFiles ?? []),
  ];

  return {
    format: options.format,
    ir,
    entries,
    warnings: [...pipelineWarnings, ...emitted.warnings],
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
