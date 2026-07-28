import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { groupArtboards } from "../../src/core/group-artboards.js";
import { processDocument } from "../../src/core/pipeline.js";
import type { Document } from "../../src/ir/types.js";

const fixturePath = resolve(import.meta.dirname, "../fixtures/ir/multiple-files-output.json");

/** Every element variant except `video` carries an id; the fixture has no videos. */
function elementId(element: object): string {
  return "id" in element && typeof element.id === "string" ? element.id : "element";
}

function docWithArtboardNames(names: string[]): Document {
  const base: Document = JSON.parse(readFileSync(fixturePath, "utf-8"));
  const template = base.artboards[0];
  return {
    ...base,
    settings: { ...base.settings, output: "multiple-files" },
    artboards: names.map((name, index) => {
      const artboard = structuredClone(template);
      artboard.id = `artboard:${index}`;
      artboard.name = name;
      artboard.width = 400 + index * 100;
      artboard.source = { ...template.source, tool: "test", name, width: artboard.width };
      artboard.layers = artboard.layers.map((layer) => ({
        ...layer,
        id: `artboard:${index}:${layer.id}`,
        elements: layer.elements.map((element) => ({
          ...element,
          id: `artboard:${index}:${elementId(element)}`,
        })),
      }));
      return artboard;
    }),
  };
}

function groupsFor(names: string[]) {
  return groupArtboards(processDocument(docWithArtboardNames(names)).document);
}

/**
 * `groupArtboards` is in the ExtendScript entry graph now (`processAndEmit` calls
 * it), so it accumulates into plain objects instead of `Map`s. These tests cover
 * what that rewrite could plausibly break — nothing here was reachable from the
 * Illustrator surface before, because the two `new Map`s are exactly why the
 * bundle could not import this module.
 */
describe("groupArtboards accumulates without Map", () => {
  it("keeps groups in first-appearance order, not in some object key order", () => {
    // The bundle's `Object.keys` is a `for...in` polyfill and ES3 leaves that
    // order unspecified, so the insertion order is carried explicitly. Numeric
    // string names are the case where a real engine reorders: V8 sorts
    // integer-like keys ahead of everything else.
    const groups = groupsFor(["zulu", "10", "alpha", "2"]);
    expect(groups.map((group) => group.name)).toEqual(["zulu", "10", "alpha", "2"]);
  });

  it("does not read a group off Object.prototype for a hostile artboard name", () => {
    // Unprefixed, `groups["__proto__"]` and `groups["constructor"]` both answer
    // with something truthy that is not an array, and the push either vanishes
    // into the prototype or throws.
    const groups = groupsFor(["__proto__", "constructor", "toString", "__proto__"]);

    expect(groups.map((group) => group.name)).toEqual(["__proto__", "constructor", "toString"]);
    expect(groups.map((group) => group.artboards.length)).toEqual([2, 1, 1]);
    expect(groups.map((group) => group.slug)).toEqual([
      "multi-file-test-proto",
      "multi-file-test-constructor",
      "multi-file-test-tostring",
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("numbers colliding slugs in first-appearance order", () => {
    // Distinct names, one slug: `makeKeyword` folds both to `hero`.
    const groups = groupsFor(["Hero!", "Hero", "hero?"]);
    expect(groups.map((group) => group.slug)).toEqual([
      "multi-file-test-hero",
      "multi-file-test-hero-2",
      "multi-file-test-hero-3",
    ]);
  });

  it("sorts a group's artboards by width and leaves the document order alone", () => {
    const doc = processDocument(docWithArtboardNames(["chart", "chart", "chart"])).document;
    const before = doc.artboards.map((artboard) => artboard.id);
    const groups = groupArtboards(doc);

    expect(groups).toHaveLength(1);
    expect(groups[0].artboards.map((artboard) => artboard.width)).toEqual([400, 500, 600]);
    expect(doc.artboards.map((artboard) => artboard.id)).toEqual(before);
  });

  it("one-file mode returns a single group sorted by breakpoint, without mutating the document", () => {
    const raw = docWithArtboardNames(["wide", "narrow", "mid"]);
    raw.settings.output = "one-file";
    const doc = processDocument(raw).document;
    const before = doc.artboards.map((artboard) => artboard.id);

    const groups = groupArtboards(doc);
    expect(groups).toHaveLength(1);
    expect(groups[0].slug).toBe("multi-file-test");
    const minWidths = groups[0].artboards.map((artboard) => artboard.breakpoint.minWidth);
    expect([...minWidths].sort((a, b) => a - b)).toEqual(minWidths);
    expect(doc.artboards.map((artboard) => artboard.id)).toEqual(before);
  });
});
