import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Resolve `relativePath` inside `absOutputDir`, or refuse to produce a path.
 *
 * Every component of an emitted path is user-influenced: the slug comes from
 * `projectName` / `metadata.slug`, the extension from `htmlOutputExtension`, and
 * bundle entries additionally from `imageOutputPath`, which is concatenated into
 * the bundle's own path list (`createOutputBundle()` in `src/output-bundle.ts`
 * constructs those entries through `artifactEntryDirectory()` /
 * `artifactEntryPath()`, which normalize separators and refuse `..`).
 *
 * Each of those is sanitized at its source; this is the sink-side backstop, so
 * that no future producer of a filename can write outside the directory the user
 * selected. `resolve()` also collapses an absolute `relativePath` onto itself,
 * which the containment test then catches.
 *
 * Containment is decided by `relative()`, not by a string prefix. The prefix
 * test (`outPath.startsWith(absOutputDir + sep)`) was wrong for every directory
 * whose path already ends in a separator — most importantly a filesystem root,
 * where `"/" + sep` is `"//"` and *no* legitimate path under it matched, so
 * `-o /` (and, structurally, `-o C:\`) rejected every file the run tried to
 * write. `relative()` normalizes both sides first, so roots, trailing
 * separators, `..` traversal, a different Windows drive (which comes back
 * absolute) and prefix look-alikes (`/out` vs `/out-evil`, which comes back
 * starting `..`) are all one check.
 */
export function resolveInsideOutputDir(absOutputDir: string, relativePath: string): string {
  const absDir = resolve(absOutputDir);
  const outPath = resolve(absDir, relativePath);
  const rel = relative(absDir, outPath);
  if (rel === "" || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error(
      `Refusing to write "${relativePath}": it resolves outside the output directory ${absOutputDir}.`,
    );
  }
  return outPath;
}
