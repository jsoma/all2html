import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeBreakpoints } from "../../src/core/compute-breakpoints.js";
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
  it("assigns single artboard range [0, Infinity]", () => {
    const doc = loadAndProcess("single-artboard-basic.json");
    expect(doc.artboards[0].breakpoint.minWidth).toBe(0);
    expect(doc.artboards[0].breakpoint.maxWidth).toBe(Infinity);
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

    // Largest: [1200, Infinity]
    expect(bps[2].minWidth).toBe(1200);
    expect(bps[2].maxWidth).toBe(Infinity);
  });
});
