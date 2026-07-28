import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { getEmitter } from "../../src/emitters/registry.js";
import { importSVGFilesFromNode } from "../../src/importers/svg/node.js";
import type { TextElement } from "../../src/ir/types.js";

const repoRoot = resolve(import.meta.dirname, "../..");

async function importAndEmit(absolutePath: string) {
  const path = basename(absolutePath);
  const result = await importSVGFilesFromNode(
    [{ path, content: readFileSync(absolutePath, "utf-8") }],
    { entrypointPaths: [path] },
  );
  const processed = processDocument(result.document);
  const emitted = getEmitter("html").emitAll(processed.document, processed.groups);
  const texts = result.document.artboards
    .flatMap((artboard) => artboard.layers)
    .flatMap((layer) => layer.elements)
    .filter((element): element is TextElement => element.type === "text");
  return { result, html: emitted.files[0].output, texts };
}

function countParagraphs(html: string): number {
  return html.match(/<p[\s>]/g)?.length ?? 0;
}

describe("Illustrator SVG live text recovery", () => {
  // Illustrator writes text position as matrix(a b c d e f) and omits x/y
  // entirely. Before matrix support, every text node in a file like this was
  // rejected and the whole graphic collapsed into a single background image.
  it("recovers live HTML text from real Illustrator matrix-positioned text", async () => {
    const { result, html, texts } = await importAndEmit(
      resolve(repoRoot, "test/fixtures/svg/illustrator/chart-labels.svg"),
    );

    // 82 <text> nodes: 76 visible, non-blank, in-bounds ones become live text.
    expect(texts).toHaveLength(76);
    expect(countParagraphs(html)).toBe(76);

    // Real chart copy, not just "something long enough".
    for (const label of ["Africa", "Asia", "Europe", "$60,000", "80 years"]) {
      expect(html).toContain(`>${label}<`);
    }

    // The 10 axis labels Illustrator exported with a horizontal scale keep that
    // scale instead of being silently rendered at the wrong width.
    const stretched = texts.filter((text) => text.transformMatrix != null);
    expect(stretched).toHaveLength(10);
    for (const text of stretched) {
      expect(text.transformMatrix).toEqual([1.0375, 0, 0, 1, 0, 0]);
    }
    expect(html.match(/transform:matrix\(1\.0375,0,0,1,0,0\)/g)).toHaveLength(10);

    // Hidden layers (Illustrator's ai2html-settings block lives in one) and
    // off-canvas scratch copy must never surface as live text.
    expect(html).not.toContain("settings text that must never reach the HTML");
    expect(html).not.toContain("off-canvas production note");
    expect(result.warnings).toContain(
      "chart-labels.svg: left text positioned outside the artboard in the background asset.",
    );
  });

  // This file is an all2html *layer* export (`interactions:svg`), not a document
  // export: 385 of its 528 text nodes sit in display:none layers (including the
  // ai2html settings block) and the remaining 143 are single-glyph fragments
  // placed far off-canvas. Correct behaviour is therefore still zero live text —
  // but it must now be zero for the right reason, with usable alt text.
  //
  // The input is a FROZEN copy exported by Illustrator 30.3.0, which wraps
  // hidden text in display:none groups; 29.8.9 emits bare <text> elements
  // instead, so re-exporting the countries fixture on a different Illustrator
  // silently changed what this test was testing. Adversarial importer inputs
  // live here, in a directory nothing regenerates — never point this at
  // data/all2html-output/, which every live fixture re-export overwrites.
  it("rasterizes the countries layer export but no longer ships an empty alt attribute", async () => {
    const { result, html, texts } = await importAndEmit(
      resolve(repoRoot, "test/fixtures/svg/illustrator/countries-artboard-4-interactions.svg"),
    );

    expect(texts).toHaveLength(0);
    expect(result.warnings).toContain(
      "countries-artboard-4-interactions.svg: left text positioned outside the artboard in the background asset.",
    );
    expect(result.warnings).toContain(
      "countries-artboard-4-interactions.svg: generated placeholder image alt text; review the alt text before publishing.",
    );
    expect(result.document.metadata.imageAltText).toBe("countries-artboard-4-interactions");
    // The same text also rides on the asset it describes, so a multi-file
    // import cannot hand this label to somebody else's graphic.
    expect(Object.values(result.document.assets).map((asset) => asset.altText)).toEqual([
      "countries-artboard-4-interactions",
    ]);
    expect(html).toContain('alt="countries-artboard-4-interactions"');
    expect(html).not.toContain('alt=""');
  });
});
