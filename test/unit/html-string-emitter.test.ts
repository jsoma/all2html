import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { emitHTMLString } from "../../src/emitters/html-string.js";
import type { Document } from "../../src/ir/types.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

describe("html-string emitter matches hast emitter", () => {
  const fixtures = ["single-artboard-basic.json", "multi-artboard-responsive.json"];

  for (const fixture of fixtures) {
    it(`produces identical output for ${fixture}`, () => {
      const raw = loadFixture(fixture);
      const { document: doc } = processDocument(raw);

      const hastResult = emitHTML(doc);
      const stringResult = emitHTMLString(doc);

      expect(stringResult.html).toBe(hastResult.html);
    });
  }

  it("handles unknown fonts identically", () => {
    const raw = loadFixture("single-artboard-basic.json");
    raw.artboards[0].layers[0].elements[0].paragraphs[0].runs[0].fontName = "CustomFont-Bold";
    const { document: doc } = processDocument(raw);

    const hastResult = emitHTML(doc);
    const stringResult = emitHTMLString(doc);

    expect(stringResult.html).toBe(hastResult.html);
  });

  it("applies shared emitter options identically", () => {
    const raw = loadFixture("tagged-text.json");
    const { document: doc } = processDocument(raw);

    const hastResult = emitHTML(doc, undefined, {
      allowUnsafeHtml: false,
      positionMode: "percentage",
    });
    const stringResult = emitHTMLString(doc, undefined, {
      allowUnsafeHtml: false,
      positionMode: "percentage",
    });

    expect(stringResult.html).toBe(hastResult.html);
  });

  it("handles duplicate artboard names with distinct background assets", () => {
    const raw: Document = {
      generator: { tool: "test", toolVersion: "1.0", pluginVersion: "0.1.0" },
      settings: { namespace: "g-" },
      fonts: [],
      artboards: [
        {
          name: "card",
          originalName: "card--640",
          width: 640,
          height: 360,
          actualWidth: 640,
          actualHeight: 360,
          layers: [
            {
              name: "content",
              type: "default",
              inlineSvg: false,
              visible: true,
              opacity: 100,
              elements: [],
            },
          ],
        },
        {
          name: "card",
          originalName: "card--960",
          width: 960,
          height: 540,
          actualWidth: 960,
          actualHeight: 540,
          layers: [
            {
              name: "content",
              type: "default",
              inlineSvg: false,
              visible: true,
              opacity: 100,
              elements: [],
            },
          ],
        },
      ],
      customBlocks: [],
      assets: {
        "card-640.png": {
          id: "card-640.png",
          path: "card-640.png",
          mimeType: "image/png",
          width: 640,
          height: 360,
          artboardName: "card",
          exportParams: { format: "png", scale: 1, transparent: false },
        },
        "card-960.png": {
          id: "card-960.png",
          path: "card-960.png",
          mimeType: "image/png",
          width: 960,
          height: 540,
          artboardName: "card",
          exportParams: { format: "png", scale: 1, transparent: false },
        },
      },
      metadata: { slug: "duplicate-assets" },
      irVersion: "0.0.0",
    };
    const { document: doc } = processDocument(raw);

    const hastResult = emitHTML(doc);
    const stringResult = emitHTMLString(doc);

    expect(stringResult.html).toBe(hastResult.html);
    expect(hastResult.html).toContain('src="all2html-output/card-640.png"');
    expect(hastResult.html).toContain('src="all2html-output/card-960.png"');
  });
});
