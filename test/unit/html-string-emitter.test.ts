import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { emitHTMLString } from "../../src/emitters/html-string.js";
import { CURRENT_IR_VERSION, type Document } from "../../src/ir/types.js";

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

  it("emits Google Fonts import mode identically", () => {
    const raw = loadFixture("single-artboard-basic.json");
    raw.settings.googleFonts = "import";
    raw.fonts = [
      { sourceFont: "Inter-Regular", family: "Inter,system-ui,sans-serif", weight: "400" },
    ];
    const { document: doc } = processDocument(raw);

    const hastResult = emitHTML(doc);
    const stringResult = emitHTMLString(doc);

    expect(stringResult.html).toBe(hastResult.html);
    expect(hastResult.html).toContain(
      '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap");',
    );
  });

  it("emits Google Fonts link mode identically", () => {
    const raw = loadFixture("single-artboard-basic.json");
    raw.settings.googleFonts = "link";
    raw.fonts = [
      { sourceFont: "Inter-Regular", family: "Inter,system-ui,sans-serif", weight: "400" },
    ];
    const { document: doc } = processDocument(raw);

    const hastResult = emitHTML(doc);
    const stringResult = emitHTMLString(doc);

    expect(stringResult.html).toBe(hastResult.html);
    expect(hastResult.html).toContain('data-all2html-google-fonts="true"');
    expect(hastResult.html).toContain(
      'href="https://fonts.googleapis.com/css2?family=Inter:wght@400&amp;display=swap"',
    );
    expect(hastResult.html).not.toContain("@import url");
  });

  it("handles duplicate artboard names with distinct background assets", () => {
    const raw: Document = {
      irVersion: CURRENT_IR_VERSION,
      source: { tool: "test", toolVersion: "1.0", adapterVersion: "0.1.0" },
      settings: { namespace: "g-" },
      fonts: [],
      artboards: [
        {
          id: "artboard:card-640",
          name: "card",
          width: 640,
          height: 360,
          source: { tool: "test", name: "card--640", width: 640, height: 360 },
          layers: [
            {
              id: "artboard:card-640:layer:content",
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
          id: "artboard:card-960",
          name: "card",
          width: 960,
          height: 540,
          source: { tool: "test", name: "card--960", width: 960, height: 540 },
          layers: [
            {
              id: "artboard:card-960:layer:content",
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
          artboardId: "artboard:card-640",
          exportParams: { format: "png", scale: 1, transparent: false },
        },
        "card-960.png": {
          id: "card-960.png",
          path: "card-960.png",
          mimeType: "image/png",
          width: 960,
          height: 540,
          artboardId: "artboard:card-960",
          exportParams: { format: "png", scale: 1, transparent: false },
        },
      },
      metadata: { slug: "duplicate-assets" },
    };
    const { document: doc } = processDocument(raw);

    const hastResult = emitHTML(doc);
    const stringResult = emitHTMLString(doc);

    expect(stringResult.html).toBe(hastResult.html);
    expect(hastResult.html).toContain('src="all2html-output/card-640.png"');
    expect(hastResult.html).toContain('src="all2html-output/card-960.png"');
  });

  it("scopes grouped output by stable artboard id", () => {
    const raw: Document = {
      irVersion: CURRENT_IR_VERSION,
      source: { tool: "test", toolVersion: "1.0", adapterVersion: "0.1.0" },
      settings: { namespace: "g-" },
      fonts: [],
      artboards: [
        {
          id: "artboard:first",
          name: "card",
          width: 640,
          height: 360,
          source: { tool: "test", name: "card", width: 640, height: 360 },
          layers: [],
        },
        {
          id: "artboard:second",
          name: "card",
          width: 640,
          height: 360,
          source: { tool: "test", name: "card copy", width: 640, height: 360 },
          layers: [],
        },
      ],
      customBlocks: [],
      assets: {
        "first.png": {
          id: "first.png",
          path: "first.png",
          mimeType: "image/png",
          width: 640,
          height: 360,
          artboardId: "artboard:first",
          exportParams: { format: "png", scale: 1, transparent: false },
        },
        "second.png": {
          id: "second.png",
          path: "second.png",
          mimeType: "image/png",
          width: 640,
          height: 360,
          artboardId: "artboard:second",
          exportParams: { format: "png", scale: 1, transparent: false },
        },
      },
      metadata: { slug: "duplicate-scope" },
    };
    const { document: doc } = processDocument(raw);
    const secondArtboard = doc.artboards.find((artboard) => artboard.id === "artboard:second");
    if (!secondArtboard) throw new Error("Missing second artboard");

    const hastResult = emitHTML(doc, { artboards: [secondArtboard], slug: "second-card" });
    const stringResult = emitHTMLString(doc, { artboards: [secondArtboard], slug: "second-card" });

    expect(stringResult.html).toBe(hastResult.html);
    expect(hastResult.html).not.toContain("first.png");
    expect(hastResult.html).toContain('src="all2html-output/second.png"');
  });
});
