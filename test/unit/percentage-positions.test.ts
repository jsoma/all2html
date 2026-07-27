import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { convertToPercentageMode } from "../../src/emitters/shared/percentage-positions.js";

function loadAndProcess(fixtureName: string) {
  const ir = JSON.parse(readFileSync(`test/fixtures/ir/${fixtureName}`, "utf-8"));
  return processDocument(ir);
}

describe("percentage positioning mode", () => {
  it("converts pixel marginLeft to translateX(-50%)", () => {
    const { document: doc } = loadAndProcess("text-alignment-matrix.json");
    const converted = convertToPercentageMode(doc);

    // Find a center-aligned text element
    for (const ab of converted.artboards) {
      for (const layer of ab.layers) {
        for (const el of layer.elements) {
          if (el.type === "text" && el.renderAs === "html") {
            const pos = el.computedPosition;
            // Should not have pixel marginLeft
            if (pos.marginLeft) {
              expect(pos.marginLeft).not.toMatch(/px$/);
            }
          }
        }
      }
    }
  });

  it("converts point text pixel width to percentage", () => {
    const { document: doc } = loadAndProcess("single-artboard-basic.json");
    const converted = convertToPercentageMode(doc);

    for (const ab of converted.artboards) {
      for (const layer of ab.layers) {
        for (const el of layer.elements) {
          if (el.type === "text" && el.renderAs === "html" && el.kind === "point") {
            // Point text width should be percentage, not pixels
            expect(el.computedPosition.width).toMatch(/%$/);
          }
        }
      }
    }
  });

  it("converts fixed-mode area text pixel width to percentage", () => {
    const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
    const converted = convertToPercentageMode(doc);

    for (const ab of converted.artboards) {
      for (const layer of ab.layers) {
        for (const el of layer.elements) {
          if (el.type === "text" && el.renderAs === "html") {
            // All widths should be percentages
            expect(el.computedPosition.width).toMatch(/%$/);
          }
        }
      }
    }
  });

  it("preserves existing rotation transforms", () => {
    const { document: doc } = loadAndProcess("rotated-text.json");
    const converted = convertToPercentageMode(doc);

    for (const ab of converted.artboards) {
      for (const layer of ab.layers) {
        for (const el of layer.elements) {
          if (el.type === "text" && el.renderAs === "html" && el.rotation) {
            // Should have both matrix and translate in transform
            const t = el.computedPosition.transform;
            expect(t).toBeDefined();
            expect(t).toContain("matrix(");
          }
        }
      }
    }
  });

  it("changes emitted HTML when positionMode is percentage", () => {
    const { document: doc } = loadAndProcess("text-alignment-matrix.json");
    const defaultHtml = emitHTML(doc).html;
    const percentageHtml = emitHTML(doc, undefined, { positionMode: "percentage" }).html;

    expect(defaultHtml).toContain("margin-left:");
    expect(percentageHtml).toContain("translateX(-50%)");
    expect(percentageHtml).not.toContain("margin-left:-");
  });
});
