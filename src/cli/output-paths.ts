import { resolve, sep } from "node:path";

/**
 * Resolve `relativePath` inside `absOutputDir`, or refuse to produce a path.
 *
 * Every component of an emitted path is user-influenced: the slug comes from
 * `projectName` / `metadata.slug`, the extension from `htmlOutputExtension`, and
 * bundle entries additionally from `imageOutputPath`, which is concatenated into
 * the bundle's own path list without any traversal check
 * (`normalizeBundlePath()` in `src/output-bundle.ts` collapses separators and
 * leaves `..` alone).
 *
 * Each of those is sanitized at its source; this is the sink-side backstop, so
 * that no future producer of a filename can write outside the directory the user
 * selected. `resolve()` also collapses an absolute `relativePath` onto itself,
 * which the containment test then catches.
 */
export function resolveInsideOutputDir(absOutputDir: string, relativePath: string): string {
  const outPath = resolve(absOutputDir, relativePath);
  if (outPath !== absOutputDir && !outPath.startsWith(absOutputDir + sep)) {
    throw new Error(
      `Refusing to write "${relativePath}": it resolves outside the output directory ${absOutputDir}.`,
    );
  }
  return outPath;
}
