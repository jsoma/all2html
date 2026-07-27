/**
 * Runtime constructors for strings that become artifact paths.
 *
 * These functions are ES3-safe because Illustrator imports the relative-output
 * directory constructor through the ExtendScript bundle.
 */

declare const artifactPathBrand: unique symbol;
export type ArtifactEntryPath = string & { readonly [artifactPathBrand]: "ArtifactEntryPath" };

function describeUnsafePath(path: string): string | undefined {
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return "contains a control character";
  }

  const slashed = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(slashed)) return "starts with a drive-letter prefix";

  const segments = slashed.split("/");
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === "..") return 'contains a ".." segment';
    if (segments[i] === "." && i > 0) return 'contains an interior "." segment';
  }
  return undefined;
}

function assertSafePath(path: string, describe: string): void {
  const problem = describeUnsafePath(path);
  if (problem !== undefined) {
    throw new Error(
      `Refusing ${describe}: "${path}" ${problem}. Artifact paths must stay inside their output root.`,
    );
  }
}

function normalizeSlashes(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^(\.?\/)+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

/** Construct a non-empty path for one artifact entry. */
export function artifactEntryPath(
  path: string,
  describe = "to create an artifact path",
): ArtifactEntryPath {
  assertSafePath(path, describe);
  const normalized = normalizeSlashes(path);
  if (normalized === "") {
    throw new Error(`Refusing ${describe}: "${path}" does not name a file.`);
  }
  return normalized as ArtifactEntryPath;
}

/**
 * Validate a user directory while preserving a site-root leading slash for
 * emitted references. Non-empty values always end in one slash.
 */
export function artifactAssetBase(path: string): string {
  if (path === "") return "";
  assertSafePath(
    path,
    'to build an output bundle with the image output directory ("imageOutputPath")',
  );
  const leadingSlash = /^[\\/]/.test(path);
  const normalized = normalizeSlashes(path);
  if (normalized === "") return leadingSlash ? "/" : "";
  return `${leadingSlash ? "/" : ""}${normalized}/`;
}

/** Validate a directory concatenated to Illustrator's document directory. */
export function relativeOutputDirectory(path: string): string {
  if (path === "") return "";
  assertSafePath(path, "to use the Illustrator output directory");
  const normalized = normalizeSlashes(path);
  return normalized === "" ? "" : `${normalized}/`;
}
