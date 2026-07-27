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
  const assetRoot = safeBundlePath(
    options.assetRoot || "",
    'the image output directory ("imageOutputPath")',
  );

  for (const asset of options.assetFiles) {
    const assetPath = safeBundlePath(asset.path, `the asset path "${asset.path}"`);
    filesWithoutManifest.push({
      path: joinBundlePath(assetRoot, assetPath),
      bytes: asset.bytes,
      mimeType: asset.mimeType,
    });
  }

  for (const emitted of options.emittedFiles) {
    const relativePath = safeBundlePath(
      `${emitted.slug}${emitted.extension}`,
      `the emitted file name "${emitted.slug}${emitted.extension}"`,
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
    zipEntries[assertSafeBundleEntryPath(file.path)] = file.bytes;
  }
  return zipSync(zipEntries, { level: 6 });
}

function createTextBundleFile(path: string, text: string, mimeType: string): OutputBundleFile {
  return {
    path: safeBundlePath(path, `the bundle entry "${path}"`),
    bytes: strToU8(text),
    mimeType,
    text,
  };
}

/**
 * Reduce a path to the one spelling the bundle stores it under.
 *
 * Separator collapsing and the leading-`./` strip are unchanged; the only
 * widening is that the leading strip now **repeats**, so `//server/share` and
 * `.//x` normalize to relative paths instead of stopping one slash short. Every
 * path that already normalized to a relative entry normalizes to the exact same
 * string, which is what keeps `getBundleFile()` lookups working — it is the same
 * function, and a lookup key must land on the entry key it named before.
 */
function normalizeBundlePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^(\.?\/)+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
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
  return safeBundlePath(path, `the bundle entry "${path}"`);
}

function safeBundlePath(path: string, describe: string): string {
  const problem = describeUnsafeBundlePath(path);
  if (problem !== undefined) {
    throw new Error(
      `Refusing to build an output bundle: ${describe} ${problem}. ` +
        "Bundle entry paths become ZIP entry names, so a name that escapes the bundle root " +
        "would write outside the folder the file is extracted into.",
    );
  }
  return normalizeBundlePath(path);
}

function describeUnsafeBundlePath(path: string): string | undefined {
  // NUL included: a name one consumer truncates and another does not is how the
  // path that was checked stops being the path that gets written. Scanned rather
  // than matched because a control character in a regex literal is itself a lint
  // error, and a suppression here would read as an exception to the rule.
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return "contains a control character";
  }
  const slashed = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(slashed)) return "starts with a drive-letter prefix";
  const segments = normalizeBundlePath(path).split("/");
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === "..") return 'contains a ".." segment, which escapes the bundle root';
    if (segments[i] === ".") return 'contains a "." segment';
  }
  return undefined;
}

function joinBundlePath(base: string, relativePath: string): string {
  const normalizedRelative = normalizeBundlePath(relativePath);
  if (!base) return normalizedRelative;
  return `${base}/${normalizedRelative}`.replace(/\/+/g, "/");
}
