import type { StructuredWarning } from "../core/warnings.js";
import type { Document, Settings } from "../ir/types.js";

export interface ImportedFile {
  path: string;
  content: string | Uint8Array;
  mimeType?: string;
}

export interface ImportedAssetFile {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
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
