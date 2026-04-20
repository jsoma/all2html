import { strToU8, zipSync } from "fflate";
import type { EmitFile } from "./emitters/registry.js";
import type { ImportedAssetFile } from "./importers/types.js";
import type { Document } from "./ir/types.js";

export interface OutputBundleFile {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
  text?: string;
}

export interface OutputBundle {
  files: OutputBundleFile[];
}

export interface OutputBundleOptions {
  irDocument: Document;
  emittedFiles: readonly EmitFile[];
  assetFiles: readonly ImportedAssetFile[];
  assetRoot?: string;
}

export function createOutputBundle(options: OutputBundleOptions): OutputBundle {
  const files: OutputBundleFile[] = [
    createTextBundleFile(
      "ir.json",
      `${JSON.stringify(options.irDocument, null, 2)}\n`,
      "application/json",
    ),
  ];
  const assetRoot = normalizeBundlePath(options.assetRoot || "");

  for (const asset of options.assetFiles) {
    files.push({
      path: joinBundlePath(assetRoot, asset.path),
      bytes: asset.bytes,
      mimeType: asset.mimeType,
    });
  }

  for (const emitted of options.emittedFiles) {
    const relativePath = `${emitted.slug}${emitted.extension}`;
    const mimeType = relativePath.endsWith(".html")
      ? "text/html"
      : relativePath.endsWith(".svelte")
        ? "text/plain"
        : relativePath.endsWith(".tsx") || relativePath.endsWith(".jsx")
          ? "text/plain"
          : "text/plain";
    files.push(createTextBundleFile(relativePath, emitted.output, mimeType));
  }

  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function getBundleFile(bundle: OutputBundle, path: string): OutputBundleFile | undefined {
  const normalized = normalizeBundlePath(path);
  return bundle.files.find((file) => file.path === normalized);
}

export function bundleToZipBytes(bundle: OutputBundle): Uint8Array {
  const zipEntries: Record<string, Uint8Array> = {};
  for (const file of bundle.files) {
    zipEntries[file.path] = file.bytes;
  }
  return zipSync(zipEntries, { level: 6 });
}

function createTextBundleFile(path: string, text: string, mimeType: string): OutputBundleFile {
  return {
    path: normalizeBundlePath(path),
    bytes: strToU8(text),
    mimeType,
    text,
  };
}

function normalizeBundlePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function joinBundlePath(base: string, relativePath: string): string {
  const normalizedRelative = normalizeBundlePath(relativePath);
  if (!base) return normalizedRelative;
  return `${base}/${normalizedRelative}`.replace(/\/+/g, "/");
}
