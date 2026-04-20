export interface LoadedSVGImportFiles {
  files: Array<{ path: string; content: string | Uint8Array; mimeType?: string }>;
  entrypointPaths: string[];
  slug: string;
}

export function normalizeSVGImportPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}
