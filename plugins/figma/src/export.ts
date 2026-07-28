import {
  bundleToZipBytes,
  createOutputBundle,
  getBrowserEmitter,
  type OutputBundle,
  processDocumentInBrowser,
  resolvedManifestSlug,
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
  /** The shared bundle object; `zipExportBundle` hands it to the shared ZIP writer. */
  outputBundle: OutputBundle;
  entries: ExportBundleEntry[];
  warnings: string[];
}

function normalizeAssetFiles(assets: readonly ExtractedAsset[]): ImportedAssetFile[] {
  const files: ImportedAssetFile[] = [];
  for (const asset of assets) {
    // An extracted asset without bytes stays out of the sidecar list; the
    // bundle's byte reconciliation then rejects the export naming the asset,
    // instead of shipping HTML that references an image the ZIP lacks.
    if (!asset.bytes) continue;
    files.push({ assetId: asset.id, bytes: asset.bytes });
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
     * The CLI passes the same object into `emitAll` (`src/cli/run.ts`);
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
    // From the *processed* document, like `assetRoot` above — the manifest and
    // the layout must read the same resolved settings.
    slug: resolvedManifestSlug(document),
    emittedFormat: options.format,
    warnings,
  });

  return {
    format: options.format,
    ir,
    outputBundle: bundle,
    entries: bundle.files.map((file) => ({
      path: file.path,
      content: file.text ?? file.bytes,
    })),
    warnings,
  };
}

/**
 * ZIP assembly is the shared writer (`bundleToZipBytes`), which re-asserts
 * entry-path containment and refuses the one entry name fflate cannot store
 * (`__proto__`). The plugin-local writer that used to sit here duplicated both
 * rules over its own `entries` list.
 */
export function zipExportBundle(bundle: FigmaExportBundle): Uint8Array {
  // level 0, explicitly: the Figma plugin sandbox is CPU-constrained, and this
  // surface has always shipped its ZIP uncompressed.
  return bundleToZipBytes(bundle.outputBundle, { level: 0 });
}
