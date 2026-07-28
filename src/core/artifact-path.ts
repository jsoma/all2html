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

/**
 * The one spelling rule for a path below an artifact root: `\` becomes `/`,
 * leading `./` and `/` are dropped, repeated separators collapse, a trailing
 * separator is dropped.
 *
 * It is exported because an asset's path has **two** readers that must agree —
 * `resolveAssetPath()` in `src/emitters/shared/assets.ts`, which prefixes it with
 * the surface's `<img src>` base, and `createOutputBundle()`, which prefixes it
 * with the bundle directory. `Asset.path` is only required to be non-empty by the
 * schema, so `/x.png` is valid IR; with the rule stated in only one of the two,
 * the emitted `src` was `assets//x.png` while the ZIP entry was `assets/x.png`.
 * One rule, one definition, both readers call it.
 *
 * Containment is deliberately *not* part of it. `artifactEntryPath()` adds that,
 * because a bundle entry becomes a ZIP entry name and there is no representable
 * entry above the root — but an `<img src>` of `../shared/logo.png` is an
 * ordinary relative URL, and asset paths are documented as relative to the IR
 * file's directory. The emitter normalizes; the bundle normalizes *and* refuses.
 */
export function artifactRelativePath(path: string): string {
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
  const normalized = artifactRelativePath(path);
  if (normalized === "") {
    throw new Error(`Refusing ${describe}: "${path}" does not name a file.`);
  }
  return normalized as ArtifactEntryPath;
}

/**
 * Validate the directory that artifact entries sit under. Empty means the
 * artifact root, and a value that *normalizes* to empty — `/`, `//`, `./` — means
 * the same thing.
 *
 * This is the directory counterpart of `artifactEntryPath()`, and it exists
 * because the two differ on exactly that case: nothing names a file, so an entry
 * of `""` is an error, while a prefix of `""` is the root and is the correct
 * reading of the site-root `imageOutputPath: "/"` that `artifactAssetBase()`
 * endorses on the URL side. Routing the directory through the entry constructor
 * turned that value into a hard export failure.
 *
 * Containment still applies: the same string is also the emitted `src` prefix,
 * so a traversing value is refused whether or not this run has assets to place.
 */
export function artifactEntryDirectory(
  path: string,
  describe = "to create an artifact path",
): string {
  if (path === "") return "";
  assertSafePath(path, describe);
  return artifactRelativePath(path);
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
  const normalized = artifactRelativePath(path);
  if (normalized === "") return leadingSlash ? "/" : "";
  return `${leadingSlash ? "/" : ""}${normalized}/`;
}

/** Validate a directory concatenated to Illustrator's document directory. */
export function relativeOutputDirectory(path: string): string {
  if (path === "") return "";
  assertSafePath(path, "to use the Illustrator output directory");
  const normalized = artifactRelativePath(path);
  return normalized === "" ? "" : `${normalized}/`;
}
