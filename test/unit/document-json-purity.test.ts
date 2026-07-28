import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertUsableArtboardDimensions } from "../../src/core/artboard-dimensions.js";
import { assertJsonPure, findImpureValues } from "../../src/core/json-purity.js";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { processAndEmit } from "../../src/extendscript/index.js";
import type { EmitterReadyDocument } from "../../src/ir/types.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

const fixtureNames = readdirSync(fixturesDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

function loadRaw(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("document model is JSON-pure (SPEC §12.2)", () => {
  it("has fixtures to check", () => {
    expect(fixtureNames.length).toBeGreaterThan(10);
  });

  // One test per fixture, four assertions inside it. The purity claim is a single
  // property of a single processed document; splitting it into four `it`s ran the
  // pipeline four times over and reported one dirty fixture four times.
  for (const name of fixtureNames) {
    it(`${name} round-trips through JSON unchanged`, () => {
      const { document, groups } = processDocument(loadRaw(name));

      // toStrictEqual, not toEqual: `{ maxWidth: undefined }` and `{}` are different
      // documents once serialized, and only toStrictEqual can tell them apart.
      const restored = roundTrip(document) as EmitterReadyDocument;
      expect(restored).toStrictEqual(document);
      expect(roundTrip(groups)).toStrictEqual(groups);

      // The observable consequence: the serialized document emits the same bytes.
      // `emitHTML` is the one HTML emitter since the emitter collapse (D23); the
      // `emitHTMLString` alias was deleted.
      expect(emitHTML(restored).html).toBe(emitHTML(document).html);

      expect(findImpureValues(document)).toEqual([]);

      for (const artboard of restored.artboards) {
        const bp = artboard.breakpoint as unknown as Record<string, unknown>;
        for (const key of ["minWidth", "maxWidth", "widthRangeMin", "widthRangeMax"]) {
          if (key in bp) {
            expect(typeof bp[key], `${artboard.id}.breakpoint.${key}`).toBe("number");
          }
        }
        // Unbounded means omitted, not null. (`settings.maxWidth` is a genuinely
        // nullable setting and is a different field entirely.)
        expect(JSON.stringify(bp)).not.toContain("null");
      }
    });
  }
});

describe("artboard dimensions are validated where Zod does not run (D21)", () => {
  it("accepts finite positive dimensions", () => {
    expect(() =>
      assertUsableArtboardDimensions(
        { artboards: [{ id: "a", name: "A", width: 600, height: 400.5 }] },
        "processAndEmit",
      ),
    ).not.toThrow();
  });

  it("names the artboard, the field and the value", () => {
    expect(() =>
      assertUsableArtboardDimensions(
        { artboards: [{ id: "artboard:mobile", name: "mobile", width: 0, height: 400 }] },
        "processAndEmit",
      ),
    ).toThrowError(/artboards\[0\] "mobile" \(#artboard:mobile\) with width = 0/);
  });

  it("rejects every unusable dimension, including non-numbers", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() =>
        assertUsableArtboardDimensions({ artboards: [{ width: bad, height: 100 }] }, "ctx"),
      ).toThrow();
    }
    // `isFinite("600")` is true; the guard checks the type first.
    expect(() =>
      assertUsableArtboardDimensions(
        { artboards: [{ width: "600" as unknown as number, height: 100 }] },
        "ctx",
      ),
    ).toThrow();
  });
});

describe("per-transform JSON-purity invariant (D21)", () => {
  it("accepts a clean document", () => {
    const { document } = processDocument(loadRaw("multi-artboard-responsive.json"));
    expect(() => assertJsonPure(document, "computePositions")).not.toThrow();
  });

  it("names the transform and the offending path", () => {
    const doc = { artboards: [{ breakpoint: { minWidth: 0, maxWidth: Infinity } }] };
    expect(() => assertJsonPure(doc, "computeBreakpoints")).toThrowError(
      /computeBreakpoints.*artboards\[0\]\.breakpoint\.maxWidth = Infinity/s,
    );
  });

  it("catches Infinity, -Infinity and NaN, nested in arrays and objects", () => {
    expect(findImpureValues({ a: Infinity })).toEqual(["a = Infinity"]);
    expect(findImpureValues({ a: -Infinity })).toEqual(["a = -Infinity"]);
    expect(findImpureValues({ a: NaN })).toEqual(["a = NaN"]);
    expect(findImpureValues([{ b: [1, 2, Number.POSITIVE_INFINITY] }])).toEqual([
      "[0].b[2] = Infinity",
    ]);
  });

  /**
   * The contract rule is "no Infinity, NaN, undefined, Map or Set anywhere in it", but
   * the checker only ever looked for non-finite numbers — so this exact object passed a
   * function whose error message promises a JSON round-trip, and `compute-positions`
   * shipped an enumerable `border: undefined` on every line shape underneath it.
   */
  it("enforces the whole contract rule, not just the non-finite clause", () => {
    expect(() => assertJsonPure({ a: undefined, b: new Map(), c: new Set() }, "t")).toThrow();
    expect(findImpureValues({ a: undefined, b: new Map(), c: new Set() })).toEqual([
      "a = undefined",
      "b = Map",
      "c = Set",
    ]);
  });

  it("catches undefined in an array, where JSON.stringify turns it into null", () => {
    expect(findImpureValues({ a: [1, undefined, 3] })).toEqual(["a[1] = undefined"]);
  });

  it("rejects by class, so an exotic nobody has met yet is caught too", () => {
    // Date and RegExp do not round-trip to themselves; functions and symbols are
    // dropped. Naming only the exotics already seen is how the gap appeared.
    expect(findImpureValues({ a: new Date(0) })).toEqual(["a = Date"]);
    expect(findImpureValues({ a: /x/ })).toEqual(["a = RegExp"]);
    expect(findImpureValues({ a: () => 1 })).toEqual(["a = function"]);
    expect(findImpureValues({ a: Symbol("s") })).toEqual(["a = symbol"]);
  });

  it("ignores values JSON can represent", () => {
    expect(
      findImpureValues({ a: 0, b: -1.5, c: null, d: "Infinity", e: true, f: [], g: {} }),
    ).toEqual([]);
    // A JSON.parse result may have a null prototype; that is still a plain object.
    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto.x = 1;
    expect(findImpureValues({ a: nullProto })).toEqual([]);
  });

  it("caps how many findings it reports", () => {
    const many = Array.from({ length: 20 }, () => Infinity);
    expect(findImpureValues(many)).toHaveLength(5);
    expect(findImpureValues(many, 2)).toHaveLength(2);
  });

  it("fires from inside the pipeline when a transform dirties the document", () => {
    // Proves the guard is wired at the boundary, not merely available as a helper:
    // a fixture whose settings carry a sentinel is caught at resolveSettings.
    const raw = loadRaw("single-artboard-basic.json");
    const inlineConfig = {
      emit: {},
      settings: { maxWidth: Number.POSITIVE_INFINITY },
    } as unknown as NonNullable<Parameters<typeof processDocument>[1]>["inlineConfig"];

    expect(() => processDocument(raw, { inlineConfig })).toThrowError(
      /resolveSettings produced a non-JSON-representable value/,
    );
  });

  describe("the ExtendScript entry point enforces the same invariant", () => {
    // The claim in SPEC §12.2 / D21 used to cover "the pipeline" while
    // `src/extendscript/index.ts` asserted nothing at all — so the Illustrator
    // path, the one that actually ships, accepted a sentinel the Node path
    // rejects and emitted `max-width: Infinitypx`. These pin that shut.

    it("rejects a non-finite setting instead of emitting `Infinitypx`", () => {
      const doc = loadRaw("single-artboard-basic.json") as Parameters<typeof processAndEmit>[0];

      expect(() =>
        processAndEmit(doc, { settings: { maxWidth: Number.POSITIVE_INFINITY } }),
      ).toThrowError(/resolveSettings produced a non-JSON-representable value/);
    });

    it("names the offending path in the message", () => {
      const doc = loadRaw("single-artboard-basic.json") as Parameters<typeof processAndEmit>[0];

      expect(() => processAndEmit(doc, { settings: { maxWidth: Number.NaN } })).toThrowError(
        /settings\.maxWidth = NaN/,
      );
    });

    it("rejects a sentinel in artwork geometry, not just in settings", () => {
      // An element coordinate rather than the artboard width this test used to
      // dirty: artboard dimensions are now rejected earlier and more precisely by
      // `assertUsableArtboardDimensions` (they are divisors), so they no longer
      // reach the purity walk. Element geometry still does, which is what this
      // asserts — the walk covers the whole document, not only `settings`.
      const doc = loadRaw("single-artboard-basic.json") as Record<string, unknown>;
      const artboards = doc.artboards as Record<string, unknown>[];
      const layers = artboards[0].layers as Record<string, unknown>[];
      const elements = layers[0].elements as Record<string, unknown>[];
      (elements[0].position as Record<string, unknown>).x = Number.POSITIVE_INFINITY;

      // Caught at the entry boundary: `resolveSettingsPure` returns the whole
      // document, so the walk covers artboards and elements, not only `settings`.
      // The exit boundary is what covers numbers the *transforms themselves* coin —
      // the original D21 shape, `computeBreakpoints` writing `Infinity` into
      // `breakpoint.maxWidth`, which no input can reproduce now that it is fixed.
      // It stays wired so a reintroduction fails on this path too, not only on the
      // Node path where `pipeline-shared.ts` would catch it.
      expect(() =>
        processAndEmit(doc as unknown as Parameters<typeof processAndEmit>[0]),
      ).toThrowError(/produced a non-JSON-representable value/);
    });

    it("rejects a divisor that would be stringified before any boundary sees it", () => {
      // The limit of the purity walk, and the reason the input guard exists.
      // `compute-positions.ts` divides by `artboard.width` and stringifies in one
      // expression, so `width: 0` used to reach the emitter as the *string*
      // "Infinity%" — both gates green, no warnings. Five boundaries would not
      // have caught it either; only an input constraint can.
      const doc = loadRaw("single-artboard-basic.json") as Record<string, unknown>;
      const artboards = doc.artboards as Record<string, unknown>[];
      artboards[0].width = 0;

      expect(() =>
        processAndEmit(doc as unknown as Parameters<typeof processAndEmit>[0]),
      ).toThrowError(/processAndEmit received artboards\[0\].*with width = 0/s);
    });

    it("rejects negative and NaN dimensions the same way Zod does on the shared path", () => {
      for (const bad of [-100, Number.NaN, Number.POSITIVE_INFINITY]) {
        const doc = loadRaw("single-artboard-basic.json") as Record<string, unknown>;
        const artboards = doc.artboards as Record<string, unknown>[];
        artboards[0].height = bad;

        expect(() =>
          processAndEmit(doc as unknown as Parameters<typeof processAndEmit>[0]),
        ).toThrowError(/height = /);
      }
    });

    it("emits no stringified sentinel for any tracked fixture", () => {
      // The assertion the purity walk cannot make for itself: the *output* carries
      // no "Infinity"/"NaN" produced by a division, on the path with no Zod.
      const doc = loadRaw("multi-artboard-responsive.json") as Parameters<typeof processAndEmit>[0];
      const { html } = processAndEmit(doc);
      expect(html).not.toContain("Infinity");
      expect(html).not.toContain("NaN");
    });

    it("passes clean documents through unchanged", () => {
      const doc = loadRaw("single-artboard-basic.json") as Parameters<typeof processAndEmit>[0];
      const result = processAndEmit(doc);
      expect(result.html).toContain("<div");
      expect(result.html).not.toContain("Infinity");
    });
  });
});
