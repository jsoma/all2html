import type { StructuredWarning } from "../core/warnings.js";
import type { Document, Settings } from "../ir/types.js";

export interface ImportedFile {
  path: string;
  content: string | Uint8Array;
  mimeType?: string;
}

/**
 * The bytes for one canonical asset. Just the bytes: `path` and `mimeType`
 * live on the `Document.assets[assetId]` record this references — the importer
 * used to write both copies from the same source and nothing checked they
 * still agreed. `createOutputBundle` reconciles this list against the
 * document's assets (exactly one byte entry per canonical asset).
 */
export interface ImportedAssetFile {
  assetId: string;
  bytes: Uint8Array;
}

export interface ImportResult {
  document: Document;
  assetFiles: ImportedAssetFile[];
  /** Plain-string projection of `structuredWarnings`. */
  warnings: string[];
  structuredWarnings: StructuredWarning[];
}

export interface ImportOptions {
  slug?: string;
  entrypointPaths?: readonly string[];
  settings?: Partial<Settings>;
}
