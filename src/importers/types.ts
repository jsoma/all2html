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
  warnings: string[];
}

export interface ImportOptions {
  slug?: string;
  entrypointPaths?: readonly string[];
  settings?: Partial<Settings>;
}

export interface ImporterDescriptor {
  name: string;
  importFiles: (files: readonly ImportedFile[], options?: ImportOptions) => Promise<ImportResult>;
}
