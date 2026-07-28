import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCssColor, formatCssColorSnapNearBlack } from "../../src/core/css-color.js";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";

/**
 * One CSS color formatter (spec §2.3). Three module-private formatters and two
 * inline `rgb(...)` builders used to disagree: shape fills/strokes and
 * `areaFill`/`areaBorder` silently dropped alpha, and the dedup key spelled
 * alpha `.toFixed(2)` while the emitted style rounded it.
 */

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function load(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

describe("formatCssColor", () => {
  it("emits rgb() for a fully opaque color", () => {
    expect(formatCssColor({ r: 10, g: 20, b: 30 })).toBe("rgb(10,20,30)");
    expect(formatCssColor({ r: 10, g: 20, b: 30, opacity: 100 })).toBe("rgb(10,20,30)");
  });

  it("emits rgba() with 2-decimal alpha, trailing zeros dropped", () => {
    expect(formatCssColor({ r: 255, g: 0, b: 0, opacity: 50 })).toBe("rgba(255,0,0,0.5)");
    expect(formatCssColor({ r: 255, g: 0, b: 0, opacity: 33.333 })).toBe("rgba(255,0,0,0.33)");
    expect(formatCssColor({ r: 255, g: 0, b: 0, opacity: 0 })).toBe("rgba(255,0,0,0)");
  });

  it("does not snap near-black", () => {
    expect(formatCssColor({ r: 30, g: 30, b: 30 })).toBe("rgb(30,30,30)");
  });
});

describe("formatCssColorSnapNearBlack", () => {
  it("snaps all-below-threshold colors to pure black, keeping alpha", () => {
    expect(formatCssColorSnapNearBlack({ r: 30, g: 30, b: 30 })).toBe("rgb(0,0,0)");
    expect(formatCssColorSnapNearBlack({ r: 35, g: 1, b: 20, opacity: 50 })).toBe(
      "rgba(0,0,0,0.5)",
    );
  });

  it("leaves colors with any channel at/above threshold alone", () => {
    expect(formatCssColorSnapNearBlack({ r: 36, g: 0, b: 0 })).toBe("rgb(36,0,0)");
  });
});

describe("alpha reaches emitted CSS at every color site", () => {
  it("shape fill and stroke keep their alpha (previously dropped)", () => {
    const raw = load("symbol-layer.json");
    const layer = raw.artboards[0].layers.find((l: { type: string }) => l.type === "symbol");
    const shape = layer.elements[0];
    shape.fill = { r: 200, g: 10, b: 10, opacity: 40 };
    shape.stroke = { width: 2, color: { r: 5, g: 120, b: 5, opacity: 25 } };

    const { html } = emitHTML(processDocument(raw).document);
    expect(html).toContain("background-color:rgba(200,10,10,0.4)");
    expect(html).toContain("border:2px solid rgba(5,120,5,0.25)");
  });

  it("does NOT snap a near-black shape fill or stroke to pure black", () => {
    const raw = load("symbol-layer.json");
    const layer = raw.artboards[0].layers.find((l: { type: string }) => l.type === "symbol");
    const shape = layer.elements[0];
    shape.fill = { r: 30, g: 30, b: 30 };
    shape.stroke = { width: 1, color: { r: 20, g: 20, b: 20 } };

    const { html } = emitHTML(processDocument(raw).document);
    expect(html).toContain("background-color:rgb(30,30,30)");
    expect(html).toContain("border:1px solid rgb(20,20,20)");
  });

  it("areaFill and areaBorder keep their alpha and do not snap", () => {
    const raw = load("area-text-styled.json");
    const el = raw.artboards[0].layers[0].elements[0];
    el.areaFill = { r: 30, g: 30, b: 30, opacity: 60 };
    el.areaBorder = { width: 1, color: { r: 25, g: 25, b: 25, opacity: 80 } };

    const { html } = emitHTML(processDocument(raw).document);
    expect(html).toContain("background-color:rgba(30,30,30,0.6)");
    expect(html).toContain("border:1px solid rgba(25,25,25,0.8)");
  });

  it("still snaps near-black text-run color (ai2html text parity)", () => {
    const raw = load("area-text-styled.json");
    const el = raw.artboards[0].layers[0].elements[0];
    el.paragraphs[0].runs[0].color = { r: 30, g: 30, b: 30 };

    const { html } = emitHTML(processDocument(raw).document);
    expect(html).toMatch(/color:\s*rgb\(0,0,0\)/);
    expect(html).not.toMatch(/color:\s*rgb\(30,30,30\)/);
  });
});

describe("areaBorder.width reaches emitted CSS (spec §2.4)", () => {
  it("emits the declared width, rounded like shape strokes", () => {
    const raw = load("area-text-styled.json");
    const el = raw.artboards[0].layers[0].elements[0];
    el.areaBorder = { width: 2.6, color: { r: 100, g: 100, b: 100 } };

    const { html } = emitHTML(processDocument(raw).document);
    expect(html).toContain("border:3px solid rgb(100,100,100)");
  });

  it("floors a sub-pixel width at 1px", () => {
    const raw = load("area-text-styled.json");
    const el = raw.artboards[0].layers[0].elements[0];
    el.areaBorder = { width: 0.2, color: { r: 100, g: 100, b: 100 } };

    const { html } = emitHTML(processDocument(raw).document);
    expect(html).toContain("border:1px solid rgb(100,100,100)");
  });
});
