/**
 * JSON-purity invariants for the document model (SPEC §12.2, decision D21).
 *
 * Zod rejects non-finite numbers at *input* (`src/ir/schema.ts`), but computed
 * documents have no equivalent gate — which is exactly how `computeBreakpoints`
 * stored `Infinity` unchallenged for as long as it did. A single JSON round-trip
 * test is necessary but not sufficient: it tells you *that* the document is dirty,
 * not *which transform* dirtied it. These assertions run at each transform boundary
 * so the failure names the transform that introduced the sentinel.
 *
 * Scope is the whole contract rule, not one clause of it: "no `Infinity`, `NaN`,
 * `undefined`, `Map` or `Set` anywhere in the document model". It used to check only the
 * first two, so `{ a: undefined, b: new Map(), c: new Set() }` passed a function whose own
 * error message promised a JSON round-trip — and `compute-positions.ts` was in fact
 * assigning an enumerable `border: undefined` on every line shape, so the claim was false
 * in shipped code while the guard stayed green.
 *
 * The rule generalizes to "every value is one JSON can represent": `null`, booleans,
 * finite numbers, strings, arrays, and plain objects. Everything else is rejected by
 * class rather than by name — `Map` and `Set` stringify to `{}`, `Date` and `RegExp` do
 * not round-trip to themselves, `undefined`/functions/symbols are dropped from objects and
 * become `null` in arrays. Naming only the exotics we have met so far is how this gap
 * appeared the first time. `Map`/`Set` are detected with `Object.prototype.toString`
 * rather than `instanceof`, because this module is compiled into the ExtendScript bundle
 * where neither global exists.
 *
 * Strings are *not* inspected: a text run reading "NaN" or an artboard named "Infinity
 * Pool" is legitimate document content, so pattern-matching strings would throw on valid
 * artwork. The sentinels that are stringified before any boundary sees them are prevented
 * at the input instead — see `assertUsableArtboardDimensions` and the note on
 * `assertJsonPure` below.
 */

/** Enumerable own keys, ES5-safe. */
function ownKeys(value: object): string[] {
  return Object.keys(value);
}

/**
 * True for `Infinity`, `-Infinity` and `NaN`. The ordered comparison covers all three:
 * NaN fails both, and each infinity fails one. Written this way rather than with the
 * global `isFinite` (which coerces its argument) or `Number.isFinite` (ES2015, absent
 * from ExtendScript — see decision D22, where a lint autofix to an ES2015+ API nearly
 * shipped). Callers must have already established `typeof n === "number"`.
 */
function isNonFiniteNumber(n: number): boolean {
  return !(n > -Infinity && n < Infinity);
}

const OBJECT_TO_STRING = Object.prototype.toString;

/**
 * `"Object"`, `"Array"`, `"Map"`, `"Date"`… from `[object X]`. ES3-safe and, unlike
 * `instanceof`, it needs neither the global nor a shared realm.
 */
function classTag(value: object): string {
  const tag = OBJECT_TO_STRING.call(value);
  return tag.slice(8, tag.length - 1);
}

/**
 * The classifier both walks share. Returns `null` when the value itself is representable
 * (containers still have to be descended into), or a short description of why it is not.
 *
 * `undefined` is a violation wherever it appears. As an object property `JSON.stringify`
 * drops the key entirely — so the document that comes back is a *different* document,
 * which is precisely what `toStrictEqual` in the round-trip test distinguishes — and in an
 * array it becomes `null`. Absence is modelled by omitting the key, never by assigning
 * `undefined` to it.
 */
function impurityOf(value: unknown): string | null {
  if (value === null) return null;

  const type = typeof value;
  if (type === "undefined") return "undefined";
  if (type === "number") return isNonFiniteNumber(value as number) ? String(value) : null;
  if (type === "string" || type === "boolean") return null;
  if (type !== "object") {
    // function, symbol, bigint: silently dropped or a TypeError at stringify time.
    return type;
  }

  const tag = classTag(value as object);
  // Arrays and plain objects are the only containers JSON has. `[object Object]` also
  // covers null-prototype objects, which is what a JSON.parse result may be.
  return tag === "Object" || tag === "Array" ? null : tag;
}

/**
 * Fast scan. No allocation, no path building, early exit on the first violation.
 * The happy path — which is every path in practice — is a type-tag walk.
 */
function hasImpureValue(value: unknown): boolean {
  if (impurityOf(value) !== null) return true;
  if (value === null || typeof value !== "object") return false;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (hasImpureValue(value[i])) return true;
    }
    return false;
  }

  const record = value as Record<string, unknown>;
  const keys = ownKeys(record);
  for (let i = 0; i < keys.length; i++) {
    if (hasImpureValue(record[keys[i]])) return true;
  }
  return false;
}

/**
 * Slow pass, only ever run once a violation is already known to exist, to produce a
 * useful message. Collects up to `limit` `path = value` descriptions.
 */
export function findImpureValues(value: unknown, limit = 5): string[] {
  const found: string[] = [];

  function walk(node: unknown, path: string): void {
    if (found.length >= limit) return;

    const impurity = impurityOf(node);
    if (impurity !== null) {
      found.push(`${path} = ${impurity}`);
      return;
    }
    if (node === null || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], `${path}[${i}]`);
      return;
    }

    const record = node as Record<string, unknown>;
    const keys = ownKeys(record);
    for (let i = 0; i < keys.length; i++) {
      walk(record[keys[i]], path ? `${path}.${keys[i]}` : keys[i]);
    }
  }

  walk(value, "");
  return found;
}

/**
 * Assert that a transform's output is JSON-representable throughout.
 *
 * Throws rather than warns: a sentinel in the document model is a contract break,
 * not a document-quality problem, and it is always a bug in this repo rather than in
 * a user's artwork (Zod already rejects non-finite input).
 *
 * Cost is one type-tag walk of the object graph with no allocation on the happy path.
 * The walk is O(document), so the *relative* cost does not shrink as documents grow —
 * an earlier "~0.18 ms, negligible" note was measured on one small fixture and did not
 * generalize. Re-measured over 20 rounds x 20 reps (median), transforms only, Zod
 * validation excluded:
 *
 *   |  processed document | transforms | + 5 guards        | + 6 guards (old) |
 *   |---------------------|------------|-------------------|------------------|
 *   |  44 KB (countries)  |  0.19 ms   | 0.26 ms  (+32%)   | 0.30 ms (+52%)   |
 *   | 168 KB (x4)         |  0.52 ms   | 0.96 ms  (+84%)   | 1.06 ms (+103%)  |
 *   | 419 KB (x10)        |  1.31 ms   | 2.41 ms  (+83%)   | 2.71 ms (+106%)  |
 *
 * That table predates widening the check to the whole contract rule, which adds one
 * `Object.prototype.toString` call per *object* node (the Map/Set/Date detection) on top
 * of the same single walk. The shape of the cost is unchanged — still one O(document)
 * pass, still no allocation on the happy path — so the numbers above are a lower bound,
 * not stale by an order of magnitude.
 *
 * So the guard approaches ~1x the cost of the transform stage it protects. It stays on
 * unconditionally anyway, because (a) in absolute terms ~1 ms on a 419 KB document is
 * noise next to the file and image I/O that surrounds any real export, and (b) a guard
 * that only runs in tests cannot catch the sentinel a user's document introduces. But
 * the number of boundaries is now chosen, not assumed: `groupArtboards` lost its
 * assertion (it only partitions existing references and coins no numbers), which is
 * worth ~20% of the total guard cost for zero coverage.
 *
 * `src/extendscript/index.ts` asserts at two boundaries rather than five — see the
 * comment there. That is the entry/exit subset: it catches every sentinel that is still
 * a *number* when the exit assertion runs, at ~40% of the five-boundary cost, but it
 * names "the pipeline" rather than the specific transform.
 *
 * **The limit of the walk, at any boundary count.** It tests `typeof === "number"`, so a
 * sentinel that is created and stringified inside a single expression is already invisible
 * by the next boundary. `compute-positions.ts:52` divides by `artboard.width` and
 * interpolates the result straight into `"…%"`, so a zero-width artboard produced
 * `left: Infinity%` with every purity gate green. Five boundaries would not have caught it
 * either — the value is never a number at any boundary. That class is closed where it can
 * be closed, at the input: Zod (`ArtboardSchema.width` is `.positive()`) on the shared path,
 * and `assertUsableArtboardDimensions` (`src/core/artboard-dimensions.ts`) on the
 * ExtendScript path, which runs no Zod. Any *new* divisor in the ExtendScript-bound
 * transforms needs the same treatment; a purity assertion will not cover it.
 */
export function assertJsonPure(value: unknown, transformName: string): void {
  if (!hasImpureValue(value)) return;

  const details = findImpureValues(value);
  throw new Error(
    `${transformName} produced a non-JSON-representable value. ` +
      `The document model must survive a JSON round-trip; JSON.stringify turns ` +
      `Infinity/-Infinity/NaN into null, drops keys whose value is undefined, and ` +
      `flattens Map/Set to {}. Model absence by absence (omit the key), not by a ` +
      `sentinel. Offending path(s): ${details.join(", ")}`,
  );
}
