import { strToU8, zipSync } from "fflate";
import {
  type ArtifactEntryPath,
  artifactEntryDirectory,
  artifactEntryPath,
  artifactRelativePath,
} from "./core/artifact-path.js";
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
  // The directory the asset entries sit under, which is **not** an entry: a value
  // that normalizes away (`/`, `//`, `./`) is the bundle root, which is what the
  // site-root `imageOutputPath: "/"` this module documents as legitimate means on
  // the ZIP side. Routing it through `artifactEntryPath()` failed it as "does not
  // name a file" — including when there were no assets to place at all.
  const assetRoot = artifactEntryDirectory(
    options.assetRoot ?? "",
    'to build an output bundle with the image output directory ("imageOutputPath")',
  );

  for (const asset of options.assetFiles) {
    const assetPath = artifactEntryPath(
      asset.path,
      `to build an output bundle with the asset path "${asset.path}"`,
    );
    filesWithoutManifest.push({
      path: joinBundlePath(assetRoot, assetPath),
      bytes: asset.bytes,
      mimeType: asset.mimeType,
    });
  }

  for (const emitted of options.emittedFiles) {
    const relativePath = artifactEntryPath(
      `${emitted.slug}${emitted.extension}`,
      `to build an output bundle with the emitted file name "${emitted.slug}${emitted.extension}"`,
    );
    const mimeType = relativePath.endsWith(".html")
      ? "text/html"
      : relativePath.endsWith(".svelte")
        ? "text/plain"
        : relativePath.endsWith(".tsx") || relativePath.endsWith(".jsx")
          ? "text/plain"
          : "text/plain";
    filesWithoutManifest.push(createTextBundleFile(relativePath, emitted.output, mimeType));
  }

  assertUniqueBundlePaths(filesWithoutManifest);
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
  const emittedPaths: Set<string> = new Set(
    options.emittedFiles.map((file) =>
      artifactEntryPath(
        `${file.slug}${file.extension}`,
        `to build an output bundle with the emitted file name "${file.slug}${file.extension}"`,
      ),
    ),
  );
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

/**
 * Lookups share the construction rule, so a key spelled any of the ways an entry
 * could have been named still lands on the entry. Lookups never throw — the
 * dropzone calls this with whatever path is selected in its file list — so this
 * is the normalizer alone, without the containment assertion construction adds.
 */
export function getBundleFile(bundle: OutputBundle, path: string): OutputBundleFile | undefined {
  const normalized = artifactRelativePath(path);
  return bundle.files.find((file) => file.path === normalized);
}

export function bundleToZipBytes(bundle: OutputBundle): Uint8Array {
  // Null prototype: fflate needs the real entry name as the key, so the `$`
  // prefix convention cannot apply here — and on a plain `{}` a file named
  // `__proto__` silently vanishes from the ZIP while every uniqueness check
  // passes. This function never rides the ExtendScript bundle, so
  // `Object.create(null)` is safe.
  const zipEntries: Record<string, Uint8Array> = Object.create(null);
  for (const file of bundle.files) {
    const entryPath = assertSafeBundleEntryPath(file.path);
    // fflate's `zipSync` re-flattens its input into a plain object internally
    // (`fltn`), where a key of exactly `__proto__` rewires that object's
    // prototype instead of storing the entry — the archive cannot carry this
    // name. Fail loudly rather than silently dropping the file or crashing
    // inside fflate. (`constructor`, `toString`, and `__proto__` as a path
    // *segment* are all fine: plain assignment shadows data properties; only
    // the exact top-level name hits the accessor.)
    if (entryPath === "__proto__") {
      throw new Error(
        'Cannot add ZIP entry named "__proto__": the ZIP encoder cannot represent that entry name.',
      );
    }
    zipEntries[entryPath] = file.bytes;
  }
  return zipSync(zipEntries, { level: 6 });
}

function createTextBundleFile(path: string, text: string, mimeType: string): OutputBundleFile {
  return {
    path: artifactEntryPath(path, `to build an output bundle with the entry "${path}"`),
    bytes: strToU8(text),
    mimeType,
    text,
  };
}

/**
 * Containment for bundle entry paths — enforced where the paths are
 * **constructed**, so every sink inherits it.
 *
 * A bundle entry path becomes a ZIP entry name in `bundleToZipBytes()`, and a
 * ZIP whose entry names contain `..` writes outside the directory the user
 * extracted into on most extractors (zip-slip). The Figma plugin hands the user
 * that ZIP directly, so the ZIP — not the filesystem — is the sink that ships
 * this. `imageOutputPath` reaches `assetRoot` from the Illustrator
 * `ai2html-settings` block, `all2html.config.json`, the CEP panel and the Figma
 * JSONC, so it is user-controlled text in every case.
 *
 * The rule: a bundle entry path is a **relative path that stays under the bundle
 * root**.
 *
 *   - `..` as a segment — rejected. There is no representable bundle entry above
 *     the root, so this is never a value we can honor, only one we can refuse.
 *   - `.` as an interior segment — rejected. It cannot escape, but it means the
 *     entry name and the extracted name differ, which is the ambiguity `..`
 *     exploits.
 *   - A drive-letter prefix (`C:/x`) — rejected. It resolves *relative* on
 *     POSIX but absolute on Windows, so containment would depend on the
 *     extracting machine.
 *   - Control characters, NUL included — rejected. They are not filename
 *     material and they are how a name gets truncated by one consumer and not
 *     another.
 *
 * A **leading `/` is not rejected**: on the bundle-producing surfaces
 * `imageOutputPath` is simultaneously the `<img src>` prefix (it is what they
 * pass as the emitters' `assetBase`), where `/all2html-output/` is an ordinary
 * site-root URL
 * (`test/fixtures/golden-ir/multiple-files-test.json` ships one). Normalization
 * has always dropped it, which contains the entry under the root; that behavior
 * is kept, and the guarantee this function adds is that normalization now leaves
 * *nothing* absolute behind.
 *
 * **Why throw rather than warn-and-fall-back** (`resolveOutputExtension()` warns
 * and falls back; `computeBreakpoints()` throws):
 *
 *   1. There is no fallback that stays correct. On these surfaces
 *      `imageOutputPath` is applied twice and the two applications must agree —
 *      the surface hands it to the emitters as `assetBase`, which puts it in the
 *      emitted `src`, and to `assetRoot`, which puts it in the bundle layout.
 *      Any value substituted here changes only the second, shipping HTML that
 *      references entries the ZIP does not contain. That is exactly the desync
 *      the `assetRoot` wiring fixed; a "safe" fallback would re-open it under a
 *      warning. `htmlOutputExtension` has one reader, so its fallback is whole.
 *   2. The repo already treats this input as fatal on the surface that has a
 *      filesystem: `resolveInsideOutputDir()` throws for `../x`. Warning in the
 *      shared builder would mean the CLI and Figma disagree about the same
 *      value.
 *   3. Every surface renders the throw as user-facing copy — Figma posts
 *      `export-error`, the dropzone renders an error state, the CLI prints and
 *      exits 1 — so this is an actionable message, not a crash.
 */
export function assertSafeBundleEntryPath(path: string): string {
  return artifactEntryPath(path, `to build an output bundle with the entry "${path}"`);
}

function joinBundlePath(base: string, relativePath: ArtifactEntryPath): string {
  if (!base) return relativePath;
  return `${base}/${relativePath}`;
}

function assertUniqueBundlePaths(files: readonly OutputBundleFile[]): void {
  const owners = new Map<string, string>();
  owners.set("manifest.json", "the generated manifest");
  for (const file of files) {
    const owner = file.path === "ir.json" ? "the canonical IR" : `the entry "${file.path}"`;
    const existing = owners.get(file.path);
    if (existing !== undefined) {
      throw new Error(
        `Refusing to build an output bundle: ${owner} collides with ${existing} at "${file.path}". Bundle entry paths must be unique.`,
      );
    }
    owners.set(file.path, owner);
  }
}
