export const DEFAULT_KEYWORD_FALLBACK = "item";

/**
 * Guard an external ID for use as a plain-object key. The `$` prefix keeps
 * hostile ids (`__proto__`, `constructor`, `toString`) off the prototype chain
 * without needing `Object.create(null)`, which ES3 (ExtendScript) lacks. Every
 * record keyed by an artboard/layer/asset id must key by `opaqueKey(id)`, on
 * write and on read. Same convention as `makeArtboardKey`'s counter below and
 * `group-artboards.ts`.
 */
export function opaqueKey(id: string): string {
  return `$${id}`;
}

/**
 * Own-property membership test. `in` walks the prototype chain, so a raw-keyed
 * record answers `true` for `toString`; this does not.
 *
 * NOT `Object.hasOwn` — ExtendScript is ES3 and has neither it nor a polyfill
 * for it. `biome check --write` will "fix" this back; do not let it.
 */
export function hasOwn(obj: object, key: string): boolean {
  // biome-ignore lint/suspicious/noPrototypeBuiltins: ES3 host, see above
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeKeyword(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function ensureCssIdentifierStart(value: string): string {
  return /^[a-z]/.test(value) ? value : `x-${value}`;
}

export function makeKeyword(name: string, fallback = DEFAULT_KEYWORD_FALLBACK): string {
  const fallbackKeyword = normalizeKeyword(fallback) || DEFAULT_KEYWORD_FALLBACK;
  const keyword = normalizeKeyword(name) || fallbackKeyword;
  return ensureCssIdentifierStart(keyword);
}

function makeOptionalKeyword(name: string): string {
  const keyword = normalizeKeyword(name);
  return keyword ? ensureCssIdentifierStart(keyword) : "";
}

function makeArtboardBaseKey(
  artboard: Pick<EmitterReadyArtboardLike, "name" | "source" | "width">,
  artboards: readonly Pick<EmitterReadyArtboardLike, "name" | "source" | "width">[],
): string {
  const duplicateCount = artboards.filter((candidate) => candidate.name === artboard.name).length;
  if (duplicateCount <= 1) {
    return makeKeyword(artboard.name, "artboard");
  }

  const sourceName = typeof artboard.source?.name === "string" ? artboard.source.name : "";
  const originalKey =
    sourceName && sourceName !== artboard.name ? makeOptionalKeyword(sourceName) : "";

  if (originalKey) {
    return originalKey;
  }

  return makeKeyword(`${artboard.name}-${artboard.width}`, "artboard");
}

interface EmitterReadyArtboardLike {
  name: string;
  source?: {
    name?: string;
  };
  width: number;
}

export function makeArtboardKey<
  T extends Pick<EmitterReadyArtboardLike, "name" | "source" | "width">,
>(artboard: T, artboards: readonly T[]): string {
  const usedCounts: Record<string, number> = {};
  let selectedKey = "";

  for (const candidate of artboards) {
    const baseKey = makeArtboardBaseKey(candidate, artboards);
    const countKey = opaqueKey(baseKey);
    const nextCount = (usedCounts[countKey] || 0) + 1;
    usedCounts[countKey] = nextCount;
    const candidateKey = nextCount === 1 ? baseKey : `${baseKey}-${nextCount}`;
    if (candidate === artboard) {
      selectedKey = candidateKey;
    }
  }

  return selectedKey || makeArtboardBaseKey(artboard, artboards);
}
