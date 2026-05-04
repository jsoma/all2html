import { strToU8, zipSync } from "fflate";
import type { EmitFile } from "./emitters/registry.js";
import type { ImportedAssetFile } from "./importers/types.js";
import type { Document, SourceMetadata } from "./ir/types.js";

export interface OutputBundleFile {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
  text?: string;
}

export interface OutputBundle {
  files: OutputBundleFile[];
  manifest: OutputBundleManifest;
}

export interface OutputBundleManifestFile {
  path: string;
  mimeType: string;
  role: "source-ir" | "emitted" | "asset" | "manifest";
  bytes: number;
}

export interface OutputBundleManifest {
  schemaVersion: "0.1.0";
  createdAt: string;
  source: SourceMetadata;
  irVersion: string;
  slug: string;
  emittedFormat?: string;
  warnings: string[];
  files: OutputBundleManifestFile[];
}

export interface OutputBundleOptions {
  irDocument: Document;
  emittedFiles: readonly EmitFile[];
  assetFiles: readonly ImportedAssetFile[];
  assetRoot?: string;
  emittedFormat?: string;
  warnings?: readonly string[];
}

export function createOutputBundle(options: OutputBundleOptions): OutputBundle {
  const filesWithoutManifest: OutputBundleFile[] = [
    createTextBundleFile(
      "ir.json",
      `${JSON.stringify(options.irDocument, null, 2)}\n`,
      "application/json",
    ),
  ];
  const assetRoot = normalizeBundlePath(options.assetRoot || "");

  for (const asset of options.assetFiles) {
    filesWithoutManifest.push({
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
    filesWithoutManifest.push(createTextBundleFile(relativePath, emitted.output, mimeType));
  }

  const sortedFiles = filesWithoutManifest.sort((a, b) => a.path.localeCompare(b.path));
  const { manifest, manifestFile } = createManifestFile(createManifest(options, sortedFiles));

  return {
    files: [...sortedFiles, manifestFile].sort((a, b) => a.path.localeCompare(b.path)),
    manifest,
  };
}

function createManifest(
  options: OutputBundleOptions,
  files: readonly OutputBundleFile[],
): OutputBundleManifest {
  const emittedPaths = new Set(options.emittedFiles.map((file) => `${file.slug}${file.extension}`));
  const slug = options.irDocument.settings.projectName || options.irDocument.metadata.slug;
  return {
    schemaVersion: "0.1.0",
    createdAt: new Date().toISOString(),
    source: options.irDocument.source,
    irVersion: options.irDocument.irVersion,
    slug,
    emittedFormat: options.emittedFormat,
    warnings: [...(options.warnings ?? [])],
    files: files.map((file) => ({
      path: file.path,
      mimeType: file.mimeType,
      role:
        file.path === "ir.json" ? "source-ir" : emittedPaths.has(file.path) ? "emitted" : "asset",
      bytes: file.bytes.byteLength,
    })),
  };
}

function createManifestFile(baseManifest: OutputBundleManifest): {
  manifest: OutputBundleManifest;
  manifestFile: OutputBundleFile;
} {
  let manifestFileBytes = 0;

  for (let attempt = 0; attempt < 10; attempt++) {
    const manifest: OutputBundleManifest = {
      ...baseManifest,
      files: [
        ...baseManifest.files,
        {
          path: "manifest.json",
          mimeType: "application/json",
          role: "manifest",
          bytes: manifestFileBytes,
        },
      ],
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestFile = createTextBundleFile("manifest.json", manifestText, "application/json");

    if (manifestFile.bytes.byteLength === manifestFileBytes) {
      return { manifest, manifestFile };
    }
    manifestFileBytes = manifestFile.bytes.byteLength;
  }

  throw new Error("Failed to stabilize manifest.json byte size.");
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
