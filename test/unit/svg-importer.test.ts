import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { getEmitter } from "../../src/emitters/registry.js";
import { importSVGFiles } from "../../src/importers/svg/import.js";
import type { TextElement } from "../../src/ir/types.js";

describe("SVG importer", () => {
  it("imports a simple SVG into live text plus a raster background asset", async () => {
    const result = await importSVGFiles(
      [
        {
          path: "canva-card--640.svg",
          content:
            '<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="360" fill="#f2f2f2"/><text x="40" y="80" font-size="40" font-family="Arial" text-anchor="start">Hello world</text></svg>',
        },
      ],
      { entrypointPaths: ["canva-card--640.svg"], slug: "canva-card" },
    );

    expect(result.document.artboards).toHaveLength(1);
    expect(result.document.artboards[0].name).toBe("canva-card");
    expect(result.document.artboards[0].layers.map((layer) => layer.type)).toEqual(["default"]);
    expect(result.document.fonts).toHaveLength(1);
    expect(result.assetFiles.map((asset) => asset.path)).toContain("canva-card-640.png");
    expect(result.warnings).toEqual([]);

    const processed = processDocument(result.document);
    const emitted = getEmitter("html").emitAll(processed.document, processed.groups);
    expect(emitted.files).toHaveLength(1);
    expect(emitted.files[0].output).toContain("Hello world");
    expect(emitted.files[0].output).toContain("canva-card-640.png");
  });

  it("groups responsive variants from safe filename annotations", async () => {
    const result = await importSVGFiles(
      [
        {
          path: "story--640.svg",
          content:
            '<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg"><text x="20" y="40" font-size="24">Mobile</text></svg>',
        },
        {
          path: "story--960.svg",
          content:
            '<svg width="960" height="540" xmlns="http://www.w3.org/2000/svg"><text x="30" y="50" font-size="32">Desktop</text></svg>',
        },
      ],
      {
        entrypointPaths: ["story--640.svg", "story--960.svg"],
        slug: "story",
      },
    );

    expect(result.document.settings.output).toBe("one-file");
    expect(result.document.artboards).toHaveLength(2);
    expect(result.document.artboards.map((artboard) => artboard.name)).toEqual(["story", "story"]);

    const processed = processDocument(result.document);
    expect(processed.groups).toHaveLength(1);

    const emitted = getEmitter("html").emitAll(processed.document, processed.groups);
    expect(emitted.files).toHaveLength(1);
    expect(emitted.files[0].output).toContain("Mobile");
    expect(emitted.files[0].output).toContain("Desktop");
  });

  it("keeps artboard IDs unique for same-named SVGs in different folders", async () => {
    const result = await importSVGFiles(
      [
        {
          path: "a/card.svg",
          content:
            '<svg width="300" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="200" fill="#ddd"/></svg>',
        },
        {
          path: "b/card.svg",
          content:
            '<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="200" fill="#eee"/></svg>',
        },
      ],
      {
        entrypointPaths: ["a/card.svg", "b/card.svg"],
        slug: "cards",
      },
    );

    expect(result.document.artboards.map((artboard) => artboard.id)).toEqual([
      "artboard:a-card",
      "artboard:b-card",
    ]);
    expect(new Set(result.document.artboards.map((artboard) => artboard.id)).size).toBe(2);
    expect(
      Object.values(result.document.assets)
        .map((asset) => asset.artboardId)
        .sort(),
    ).toEqual(["artboard:a-card", "artboard:b-card"]);
  });

  it("fails when responsive variants resolve to duplicate widths", async () => {
    await expect(
      importSVGFiles(
        [
          {
            path: "story--640.svg",
            content: '<svg width="640" height="360"><text x="10" y="20">One</text></svg>',
          },
          {
            path: "story:960.svg",
            content: '<svg width="640" height="360"><text x="10" y="20">Two</text></svg>',
          },
        ],
        {
          entrypointPaths: ["story--640.svg", "story:960.svg"],
          slug: "story",
        },
      ),
    ).rejects.toThrow(/unique widths/);
  });

  it("keeps unsupported transformed text in the raster background and warns", async () => {
    const result = await importSVGFiles(
      [
        {
          path: "rotated.svg",
          content:
            '<svg width="200" height="100"><text x="20" y="30" transform="rotate(12)">Rotated</text></svg>',
        },
      ],
      { entrypointPaths: ["rotated.svg"], slug: "rotated" },
    );

    expect(result.warnings).toContain(
      "rotated.svg: left transformed text in SVG background asset.",
    );
    expect(result.warnings).toContain(
      "rotated.svg: no live HTML text could be recovered from SVG text nodes.",
    );
    expect(result.document.artboards[0].layers).toHaveLength(0);
    const pngAsset = result.assetFiles.find((asset) => asset.path.endsWith(".png"));
    expect(pngAsset).toBeDefined();
    expect(pngAsset?.mimeType).toBe("image/png");
  });

  it("recovers text inside translated parent groups at the correct position", async () => {
    const result = await importSVGFiles(
      [
        {
          path: "translated-group.svg",
          content:
            '<svg width="200" height="120"><g transform="translate(30 40)"><text x="10" y="20" font-size="20">Shifted</text></g></svg>',
        },
      ],
      { entrypointPaths: ["translated-group.svg"], slug: "translated-group" },
    );

    const textElement = result.document.artboards[0].layers[0].elements[0] as TextElement;
    expect(textElement.type).toBe("text");
    expect(textElement.position.x).toBe(40);
    expect(textElement.position.y).toBe(40);
  });

  it("honors the first tspan x attribute and dy values with em units", async () => {
    const result = await importSVGFiles(
      [
        {
          path: "tspan-positioning.svg",
          content:
            '<svg width="200" height="120"><text x="10" y="20" font-size="10"><tspan x="40" dy="1.2em">Hello</tspan></text></svg>',
        },
      ],
      { entrypointPaths: ["tspan-positioning.svg"], slug: "tspan-positioning" },
    );

    const textElement = result.document.artboards[0].layers[0].elements[0] as TextElement;
    expect(textElement.type).toBe("text");
    expect(textElement.position.x).toBe(40);
    expect(textElement.position.y).toBe(22);
  });

  it("uses jpg for raster-backed auto exports and bakes linked images into the background", async () => {
    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const result = await importSVGFiles(
      [
        {
          path: "graphic.svg",
          content:
            '<svg width="300" height="200"><image href="images/photo.png" width="100" height="80"/></svg>',
        },
        {
          path: "images/photo.png",
          content: pngBytes,
          mimeType: "image/png",
        },
      ],
      { entrypointPaths: ["graphic.svg"], slug: "graphic" },
    );

    expect(result.assetFiles).toHaveLength(1);
    expect(result.assetFiles[0].path).toBe("graphic.jpg");
    expect(result.assetFiles[0].mimeType).toBe("image/jpeg");
    expect(result.document.assets["graphic.jpg"]?.mimeType).toBe("image/jpeg");
  });

  it("resolves linked image assets with URL-encoded names and query fragments", async () => {
    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const result = await importSVGFiles(
      [
        {
          path: "graphic.svg",
          content:
            '<svg width="300" height="200"><image href="images/photo%20card.png?v=1#hero" width="100" height="80"/></svg>',
        },
        {
          path: "images/photo card.png",
          content: pngBytes,
          mimeType: "image/png",
        },
      ],
      { entrypointPaths: ["graphic.svg"], slug: "graphic" },
    );

    expect(result.warnings.some((warning) => /missing linked image asset/.test(warning))).toBe(
      false,
    );
    expect(result.assetFiles[0].path).toBe("graphic.jpg");
  });

  it("honors explicit jpg import settings", async () => {
    const result = await importSVGFiles(
      [
        {
          path: "graphic.svg",
          content:
            '<svg width="300" height="200"><rect width="300" height="200" fill="#f2f2f2"/><text x="20" y="40">Forced JPG</text></svg>',
        },
      ],
      {
        entrypointPaths: ["graphic.svg"],
        slug: "graphic",
        settings: { imageFormat: ["jpg"], use2xImages: false, jpgQuality: 72 },
      },
    );

    expect(result.assetFiles[0].path).toBe("graphic.jpg");
    expect(result.document.assets["graphic.jpg"]?.exportParams.quality).toBe(72);
  });

  it("preserves explicit output-related settings passed into the importer", async () => {
    const result = await importSVGFiles(
      [
        {
          path: "graphic.svg",
          content:
            '<svg width="300" height="200"><rect width="300" height="200" fill="#f2f2f2"/><text x="20" y="40">Configured</text></svg>',
        },
      ],
      {
        entrypointPaths: ["graphic.svg"],
        slug: "graphic",
        settings: {
          output: "multiple-files",
          imageOutputPath: "images",
          htmlOutputPath: "html",
        },
      },
    );

    expect(result.document.settings.output).toBe("multiple-files");
    expect(result.document.settings.imageOutputPath).toBe("images");
    expect(result.document.settings.htmlOutputPath).toBe("html");
  });

  it("accepts a custom rasterizer so browser callers can provide their own backend", async () => {
    let calls = 0;
    const result = await importSVGFiles(
      [
        {
          path: "custom.svg",
          content: '<svg width="2" height="1"><rect width="2" height="1" fill="#000"/></svg>',
        },
      ],
      {
        entrypointPaths: ["custom.svg"],
        slug: "custom",
        rasterizer: {
          async rasterizeSvg() {
            calls += 1;
            return {
              width: 2,
              height: 1,
              pixels: Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255]),
            };
          },
        },
      },
    );

    expect(calls).toBe(1);
    expect(result.assetFiles[0].path).toBe("custom.png");
    expect(result.assetFiles[0].mimeType).toBe("image/png");
  });
});

describe("SVG importer matrix transforms", () => {
  async function importSvg(body: string, width = 400, height = 300) {
    return importSVGFiles(
      [
        {
          path: "chart.svg",
          content: `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="#f6f6f6"/>${body}</svg>`,
        },
      ],
      { entrypointPaths: ["chart.svg"], slug: "chart" },
    );
  }

  function textElements(document: { artboards: { layers: { elements: unknown[] }[] }[] }) {
    return document.artboards
      .flatMap((artboard) => artboard.layers)
      .flatMap((layer) => layer.elements)
      .filter((element): element is TextElement => (element as TextElement).type === "text");
  }

  it("recovers Illustrator text positioned only by a translate matrix", async () => {
    // Illustrator omits x/y entirely and carries the position in the matrix.
    const result = await importSvg(
      '<text transform="matrix(1 0 0 1 120 80)" font-size="20" font-family="Arial">Live label</text>',
    );

    const texts = textElements(result.document);
    expect(texts).toHaveLength(1);
    expect(texts[0].paragraphs[0].text).toBe("Live label");
    expect(texts[0].position.x).toBeCloseTo(120, 4);
    // Top is the baseline minus the font size.
    expect(texts[0].position.y).toBeCloseTo(60, 4);
    expect(texts[0].transformMatrix).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("folds a uniform matrix scale into font size and position", async () => {
    const result = await importSvg(
      '<text transform="matrix(2 0 0 2 50 60)" font-size="10" font-family="Arial">Scaled</text>',
    );

    const [text] = textElements(result.document);
    expect(text.paragraphs[0].runs[0].fontSize).toBeCloseTo(20, 4);
    expect(text.position.x).toBeCloseTo(50, 4);
    expect(text.position.y).toBeCloseTo(40, 4);
    // Uniform scale needs no residual CSS transform.
    expect(text.transformMatrix).toBeUndefined();
  });

  it("keeps a non-uniform matrix scale as a horizontal CSS stretch", async () => {
    const uniform = await importSvg(
      '<text transform="matrix(1 0 0 1 60 100)" font-size="16" font-family="Arial">Squeezed</text>',
    );
    const stretched = await importSvg(
      '<text transform="matrix(1.0375 0 0 1 60 100)" font-size="16" font-family="Arial">Squeezed</text>',
    );

    const [plain] = textElements(uniform.document);
    const [scaled] = textElements(stretched.document);

    // Vertical metrics are untouched by a horizontal-only scale...
    expect(scaled.paragraphs[0].runs[0].fontSize).toBe(plain.paragraphs[0].runs[0].fontSize);
    expect(scaled.position.width).toBeCloseTo(plain.position.width, 6);
    // ...and the stretch survives as an explicit transform rather than silently
    // rendering the text at the wrong width.
    expect(scaled.transformMatrix).toEqual([1.0375, 0, 0, 1, 0, 0]);

    const processed = processDocument(stretched.document);
    const emitted = getEmitter("html").emitAll(processed.document, processed.groups);
    expect(emitted.files[0].output).toContain("transform:matrix(1.0375,0,0,1,0,0)");
    expect(emitted.files[0].output).toContain("transform-origin:0% 0%");
  });

  it("leaves rotated matrix text in the raster background", async () => {
    const result = await importSvg(
      '<text transform="matrix(0.7071 0.7071 -0.7071 0.7071 100 50)" font-size="16">Rotated</text>',
    );

    expect(textElements(result.document)).toHaveLength(0);
    expect(result.warnings).toContain("chart.svg: left transformed text in SVG background asset.");
  });

  it("names mirrored text specifically instead of using the generic transform warning", async () => {
    const result = await importSvg(
      '<text transform="matrix(1 0 0 -1 100 200)" font-size="16">Flipped</text>',
    );

    expect(textElements(result.document)).toHaveLength(0);
    expect(result.warnings).toContain(
      "chart.svg: left mirrored or flipped text in SVG background asset.",
    );
  });

  it("recovers unrotated siblings of rotated text", async () => {
    const result = await importSvg(
      [
        '<text transform="matrix(0.7071 0.7071 -0.7071 0.7071 100 50)" font-size="16">Rotated</text>',
        '<text transform="matrix(1 0 0 1 40 120)" font-size="16">Upright</text>',
      ].join(""),
    );

    const texts = textElements(result.document);
    expect(texts).toHaveLength(1);
    expect(texts[0].paragraphs[0].text).toBe("Upright");
  });

  it("composes group transforms with the text transform", async () => {
    const result = await importSvg(
      '<g transform="translate(10 20)"><g transform="scale(2)"><text transform="matrix(1 0 0 1 5 10)" font-size="8" font-family="Arial">Nested</text></g></g>',
    );

    const [text] = textElements(result.document);
    // translate(10,20) · scale(2) · translate(5,10) => x = 10 + 2*5, y = 20 + 2*10
    expect(text.position.x).toBeCloseTo(20, 4);
    expect(text.paragraphs[0].runs[0].fontSize).toBeCloseTo(16, 4);
    expect(text.position.y).toBeCloseTo(40 - 16, 4);
  });

  it("skips text inside display:none subtrees", async () => {
    const result = await importSvg(
      [
        '<g id="ai2html-settings" display="none"><text transform="matrix(1 0 0 1 20 20)" display="inline" font-size="12">settings: do not publish</text></g>',
        '<text transform="matrix(1 0 0 1 40 120)" font-size="16" font-family="Arial">Visible</text>',
      ].join(""),
    );

    const texts = textElements(result.document);
    expect(texts).toHaveLength(1);
    expect(texts[0].paragraphs[0].text).toBe("Visible");
  });

  it("skips text placed entirely outside the artboard", async () => {
    const result = await importSvg(
      [
        '<text transform="matrix(1 0 0 1 -452 -91)" font-size="12">off-canvas note</text>',
        '<text transform="matrix(1 0 0 1 40 120)" font-size="16" font-family="Arial">On canvas</text>',
      ].join(""),
    );

    const texts = textElements(result.document);
    expect(texts).toHaveLength(1);
    expect(texts[0].paragraphs[0].text).toBe("On canvas");
    expect(result.warnings).toContain(
      "chart.svg: left text positioned outside the artboard in the background asset.",
    );
  });

  it("synthesizes reviewable alt text when no text at all could be recovered", async () => {
    const result = await importSvg(
      '<text transform="matrix(0.7071 0.7071 -0.7071 0.7071 100 50)" font-size="16">Unemployment by county</text>',
    );

    expect(result.document.metadata.imageAltText).toBe("Unemployment by county");
    expect(result.warnings).toContain(
      "chart.svg: generated placeholder image alt text; review metadata.imageAltText before publishing.",
    );

    const processed = processDocument(result.document);
    const emitted = getEmitter("html").emitAll(processed.document, processed.groups);
    expect(emitted.files[0].output).toContain('alt="Unemployment by county"');
    expect(emitted.files[0].output).not.toContain('alt=""');
  });

  it("falls back to the artboard name when the discarded text is unusable", async () => {
    const result = await importSvg(
      '<text transform="matrix(1 0 0 1 -900 -900)" font-size="12">off-canvas only</text>',
    );

    expect(result.document.metadata.imageAltText).toBe("chart");
  });

  it("does not warn about unrecovered text when the only text is hidden", async () => {
    const result = await importSvg(
      '<g display="none"><text transform="matrix(1 0 0 1 20 20)" font-size="12">hidden</text></g>',
    );

    expect(result.warnings).not.toContain(
      "chart.svg: no live HTML text could be recovered from SVG text nodes.",
    );
    expect(result.document.metadata.imageAltText).toBeUndefined();
  });
});
