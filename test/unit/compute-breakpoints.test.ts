import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeBreakpoints } from "../../src/core/compute-breakpoints.js";
import { findImpureValues } from "../../src/core/json-purity.js";
import { resolveSettings } from "../../src/core/resolve-settings.js";
import { loadAndValidateIR } from "../../src/ir/validate.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function loadAndProcess(name: string) {
  const raw = JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
  const doc = loadAndValidateIR(raw);
  const resolved = resolveSettings(doc);
  return computeBreakpoints(resolved);
}

describe("computeBreakpoints", () => {
  it("leaves a single artboard's upper bound absent rather than Infinity", () => {
    const doc = loadAndProcess("single-artboard-basic.json");
    expect(doc.artboards[0].breakpoint.minWidth).toBe(0);
    expect(doc.artboards[0].breakpoint.maxWidth).toBeUndefined();
    // Absence must be real absence: the key is not present at all, so JSON.stringify
    // drops it instead of writing null.
    expect("maxWidth" in doc.artboards[0].breakpoint).toBe(false);
  });

  it("assigns correct ranges for 3 artboards", () => {
    const doc = loadAndProcess("multi-artboard-responsive.json");
    // Sorted by width: 320, 768, 1200
    const sorted = [...doc.artboards].sort((a, b) => a.width - b.width);
    const bps = sorted.map((ab) => ab.breakpoint);

    // Smallest: [0, 767]
    expect(bps[0].minWidth).toBe(0);
    expect(bps[0].maxWidth).toBe(767);

    // Middle: [768, 1199]
    expect(bps[1].minWidth).toBe(768);
    expect(bps[1].maxWidth).toBe(1199);

    // Largest: [1200, unbounded]
    expect(bps[2].minWidth).toBe(1200);
    expect(bps[2].maxWidth).toBeUndefined();
    expect("maxWidth" in bps[2]).toBe(false);
  });

  /**
   * Ranges are scoped to the responsive group, not the document.
   *
   * They used to be computed across every artboard in the document while
   * grouping happened at the far end of the pipeline, so artboards that never
   * share a page constrained each other. Where two groups held the same width
   * the result was an empty range — the live Illustrator export
   * `multiple-files-test-artboard-2.html` carried
   * `data-min-width="600" data-max-width="599"`, which matches no viewport at
   * all, so that artboard could never display.
   */
  describe("multiple-files: groups do not constrain each other", () => {
    function twoGroups() {
      const raw = JSON.parse(
        readFileSync(resolve(fixturesDir, "multiple-files-output.json"), "utf-8"),
      );
      const [chart, map] = raw.artboards;
      const clone = (source: Record<string, unknown>, name: string, width: number) => {
        const copy = JSON.parse(JSON.stringify(source));
        copy.name = name;
        copy.width = width;
        copy.id = `artboard:${name}:${width}`;
        copy.source = { ...copy.source, name, width };
        for (const layer of copy.layers) layer.id = `${copy.id}:layer:${layer.name}`;
        return copy;
      };
      // Interleaved on purpose: the group a range belongs to must not depend on
      // where the artboard sits in the document.
      raw.artboards = [
        clone(chart, "chart", 300),
        clone(map, "map", 400),
        clone(chart, "chart", 600),
        clone(map, "map", 600),
      ];
      const doc = computeBreakpoints(resolveSettings(loadAndValidateIR(raw)));
      const byKey: Record<string, (typeof doc.artboards)[number]["breakpoint"]> = {};
      for (const ab of doc.artboards) byKey[`${ab.name}:${ab.width}`] = ab.breakpoint;
      return byKey;
    }

    it("gives each group its own unbounded widest artboard", () => {
      const bps = twoGroups();
      // 600 is the widest in *both* groups, so both are unbounded above. Under
      // the global computation only one of the two could be.
      expect(bps["chart:600"].maxWidth).toBeUndefined();
      expect("maxWidth" in bps["chart:600"]).toBe(false);
      expect(bps["map:600"].maxWidth).toBeUndefined();
      expect("maxWidth" in bps["map:600"]).toBe(false);
    });

    it("bounds each artboard by the next width in its own group only", () => {
      const bps = twoGroups();
      // chart: 300 -> [0, 599] (capped by chart's own 600, not by map's 400)
      expect(bps["chart:300"].minWidth).toBe(0);
      expect(bps["chart:300"].maxWidth).toBe(599);
      // map: 400 -> [0, 599]
      expect(bps["map:400"].minWidth).toBe(0);
      expect(bps["map:400"].maxWidth).toBe(599);
      expect(bps["chart:600"].minWidth).toBe(600);
      expect(bps["map:600"].minWidth).toBe(600);
    });

    it("emits no empty range", () => {
      for (const bp of Object.values(twoGroups())) {
        if (bp.maxWidth === undefined) continue;
        expect(bp.maxWidth, `range ${bp.minWidth}..${bp.maxWidth} is empty`).toBeGreaterThanOrEqual(
          bp.minWidth,
        );
      }
    });

    it("still computes across the whole document in one-file mode", () => {
      const raw = JSON.parse(
        readFileSync(resolve(fixturesDir, "multiple-files-output.json"), "utf-8"),
      );
      raw.settings.output = "one-file";
      const doc = computeBreakpoints(resolveSettings(loadAndValidateIR(raw)));
      const sorted = [...doc.artboards].sort((a, b) => a.width - b.width);
      // Differently-named artboards share one page here, so they do bound each
      // other: 600 is capped by 800.
      expect(sorted[0].breakpoint.maxWidth).toBe(799);
      expect(sorted[1].breakpoint.maxWidth).toBeUndefined();
    });
  });

  /**
   * Equal widths in *different* groups are legal and covered above. Equal widths
   * in the *same* group are not: the ranges are derived from the order of the
   * sorted widths, so a tie made "which variant is the phone layout" a function
   * of array order. `plugins/figma/` already threw on this at extraction; the
   * rule now lives in the core so Illustrator, the CLI and SVG import inherit it
   * instead of each guessing.
   */
  describe("duplicate widths inside one responsive group", () => {
    function docWith(widths: [string, number][], output: "one-file" | "multiple-files") {
      const raw = JSON.parse(
        readFileSync(resolve(fixturesDir, "multiple-files-output.json"), "utf-8"),
      );
      const [source] = raw.artboards;
      raw.settings.output = output;
      raw.artboards = widths.map(([name, width], i) => {
        const copy = JSON.parse(JSON.stringify(source));
        copy.name = name;
        copy.width = width;
        copy.id = `artboard:${name}-${i + 1}`;
        copy.source = { ...copy.source, name, width };
        for (const layer of copy.layers) layer.id = `${copy.id}:layer:${layer.name}`;
        return copy;
      });
      return resolveSettings(loadAndValidateIR(raw));
    }

    it("fails the export instead of guessing which 600px variant is the phone layout", () => {
      expect(() =>
        computeBreakpoints(
          docWith(
            [
              ["chart", 300],
              ["chart", 600],
              ["chart", 600],
            ],
            "multiple-files",
          ),
        ),
      ).toThrow(/Responsive artboards named "chart" must have unique widths/);
    });

    it("names both artboards, the width, and the two ways out", () => {
      let message = "";
      try {
        computeBreakpoints(
          docWith(
            [
              ["chart", 600],
              ["chart", 600],
            ],
            "multiple-files",
          ),
        );
      } catch (error) {
        message = (error as Error).message;
      }
      // A desk has to be able to act on this without reading the code: the ids
      // are what tells two identically-named artboards apart.
      expect(message).toContain("duplicate width 600");
      expect(message).toContain('"chart" (artboard:chart-1)');
      expect(message).toContain('"chart" (artboard:chart-2)');
      expect(message).toContain("different width");
      expect(message).toContain("own responsive group");
    });

    it("applies in one-file mode too, where every artboard is one group", () => {
      let message = "";
      try {
        computeBreakpoints(
          docWith(
            [
              ["chart", 600],
              ["map", 600],
            ],
            "one-file",
          ),
        );
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("Artboards on a single page must have unique widths");
      expect(message).toContain('"chart" (artboard:chart-1)');
      expect(message).toContain('"map" (artboard:map-2)');
      // The remedy differs: renaming alone does nothing while everything is on
      // one page.
      expect(message).toContain('"output" to "multiple-files"');
    });

    it("still accepts the same width in two different groups", () => {
      expect(() =>
        computeBreakpoints(
          docWith(
            [
              ["chart", 600],
              ["map", 600],
            ],
            "multiple-files",
          ),
        ),
      ).not.toThrow();
    });
  });

  it("never stores a non-finite number in any breakpoint", () => {
    for (const name of ["single-artboard-basic.json", "multi-artboard-responsive.json"]) {
      const doc = loadAndProcess(name);
      for (const ab of doc.artboards) {
        expect(findImpureValues(ab.breakpoint)).toEqual([]);
      }
    }
  });
});
