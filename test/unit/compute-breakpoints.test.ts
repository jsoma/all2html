import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeBreakpoints } from "../../src/core/compute-breakpoints.js";
import { findNonFiniteNumbers } from "../../src/core/json-purity.js";
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

  it("never stores a non-finite number in any breakpoint", () => {
    for (const name of ["single-artboard-basic.json", "multi-artboard-responsive.json"]) {
      const doc = loadAndProcess(name);
      for (const ab of doc.artboards) {
        expect(findNonFiniteNumbers(ab.breakpoint)).toEqual([]);
      }
    }
  });
});
