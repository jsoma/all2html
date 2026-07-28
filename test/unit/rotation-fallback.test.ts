import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";

/**
 * Rotation without a matrix (spec §2.5). `rotation` is CSS-clockwise degrees;
 * a present, non-identity `transformMatrix` is the full transform and wins
 * alone. Figma emits `rotation` and never a matrix, which used to produce no
 * transform CSS at all.
 */

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function load(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

function textElement(doc: ReturnType<typeof processDocument>["document"]) {
  for (const ab of doc.artboards) {
    for (const layer of ab.layers) {
      for (const el of layer.elements) {
        if (el.type === "text" && el.renderAs === "html") return el;
      }
    }
  }
  throw new Error("no html text element in document");
}

describe("rotation fallback in computeTextPosition", () => {
  it("emits rotate(<deg>deg) when rotation is set without a matrix", () => {
    const raw = load("rotated-text.json");
    const el = raw.artboards[0].layers[0].elements[0];
    delete el.transformMatrix;
    el.rotation = 45;

    const { document: doc } = processDocument(raw);
    const positioned = textElement(doc);
    expect(positioned.computedPosition.transform).toBe("rotate(45deg)");
    // Same transform-origin rule as the matrix path (valign middle → 50%).
    expect(positioned.computedPosition.transformOrigin).toBe("50% 50%");

    const { html } = emitHTML(doc);
    expect(html).toContain("transform:rotate(45deg)");
  });

  it("uses the valign-derived transform origin", () => {
    const raw = load("rotated-text.json");
    const el = raw.artboards[0].layers[0].elements[0];
    delete el.transformMatrix;
    el.rotation = -30;
    el.valign = "bottom";

    const positioned = textElement(processDocument(raw).document);
    expect(positioned.computedPosition.transform).toBe("rotate(-30deg)");
    expect(positioned.computedPosition.transformOrigin).toBe("50% 100%");
  });

  it("emits the matrix alone — rotation is never applied on top of it", () => {
    const raw = load("rotated-text.json");
    // Fixture carries both rotation: 45 and the equivalent matrix.
    const positioned = textElement(processDocument(raw).document);
    expect(positioned.computedPosition.transform).toContain("matrix(");
    expect(positioned.computedPosition.transform).not.toContain("rotate(");
  });

  it("emits no transform when rotation is 0 and the matrix is identity", () => {
    const raw = load("rotated-text.json");
    const el = raw.artboards[0].layers[0].elements[0];
    el.rotation = 0;
    el.transformMatrix = [1, 0, 0, 1, 0, 0];

    const positioned = textElement(processDocument(raw).document);
    expect(positioned.computedPosition.transform).toBeUndefined();
  });
});
