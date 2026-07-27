/**
 * Input guard for the one class of sentinel the JSON-purity walk cannot see.
 *
 * `assertJsonPure` tests `typeof value === "number"`. `compute-positions.ts`
 * divides by `artboard.width` / `artboard.height` and *immediately* stringifies
 * the quotient (`${round((pos.x / artboardWidth) * 100)}%`), so a zero divisor
 * becomes the string `"Infinity%"` before the exit assertion runs, and the walk
 * has nothing left to find. A document with `artboards[0].width = 0` really did
 * emit `left: Infinity%` with both purity gates green and zero warnings.
 *
 * On the Node/browser path Zod closes this at input: `ArtboardSchema.width` is
 * `z.number().positive()`. The ExtendScript path never runs Zod — that is exactly
 * why D21 put the purity assertions there — so it needs the same constraint
 * expressed directly. Artboard width and height are the *only* divisors in the
 * ExtendScript-bound transforms (`compute-positions.ts`, `html-string.ts`'s
 * aspect ratio and padding, `percentage-positions.ts`), so this is the whole
 * class, not a sample of it.
 *
 * ES3-safe: index loops, no `Array.prototype` methods beyond what
 * `src/extendscript/polyfills.ts` installs, and `isFinite` is ES3.
 */

interface ArtboardDimensionsLike {
  id?: string;
  name?: string;
  width: number;
  height: number;
}

interface DocumentDimensionsLike {
  artboards: ArtboardDimensionsLike[];
}

function describeArtboard(artboard: ArtboardDimensionsLike, index: number): string {
  const name = artboard.name ? `"${artboard.name}"` : "";
  const id = artboard.id ? `#${artboard.id}` : "";
  const label = name && id ? `${name} (${id})` : name || id;
  return label ? `artboards[${index}] ${label}` : `artboards[${index}]`;
}

function isUsableDimension(value: unknown): boolean {
  // `typeof` first: `isFinite("10")` coerces and would accept a string.
  if (typeof value !== "number") return false;
  const n = value as number;
  // Excludes NaN (fails both comparisons) and both infinities (each fails one).
  return n > 0 && n < Infinity;
}

/**
 * Throw unless every artboard has a finite, strictly positive width and height.
 *
 * Throws rather than warns, and throws before any transform runs: the alternative
 * is a silently broken stylesheet, and by the time the value has been divided and
 * stringified there is no number left to detect.
 */
export function assertUsableArtboardDimensions(doc: DocumentDimensionsLike, context: string): void {
  const artboards = doc.artboards;
  if (!artboards) return;

  for (let i = 0; i < artboards.length; i++) {
    const artboard = artboards[i];
    if (!artboard) continue;
    const badWidth = !isUsableDimension(artboard.width);
    const badHeight = !isUsableDimension(artboard.height);
    if (!badWidth && !badHeight) continue;

    const field = badWidth ? "width" : "height";
    const value = badWidth ? artboard.width : artboard.height;
    throw new Error(
      `${context} received ${describeArtboard(artboard, i)} with ${field} = ${String(value)}. ` +
        `Artboard width and height must be finite and greater than zero: every position is a ` +
        `percentage of them, so a bad divisor reaches CSS as "left: Infinity%" — a string, ` +
        `which the JSON-purity assertions cannot see.`,
    );
  }
}
