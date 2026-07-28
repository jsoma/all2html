import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";

/**
 * `visible: false` layers produce nothing, for every layer kind (spec §2.6).
 * No emitter read `Layer.visible` before this: a hidden layer rendered anyway,
 * silently diverging from the design tool — including hook layers, whose raw
 * HTML a designer thought they had turned off.
 */

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function load(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

type RawLayer = { name: string; type: string; visible: boolean };

describe("invisible layers are skipped by the HTML emitter", () => {
  it("skips a hidden default (text) layer", () => {
    const raw = load("single-artboard-basic.json");
    const visibleHtml = emitHTML(processDocument(load("single-artboard-basic.json")).document).html;

    for (const layer of raw.artboards[0].layers as RawLayer[]) {
      if (layer.type === "default") layer.visible = false;
    }
    const { html } = emitHTML(processDocument(raw).document);
    // (`aiAbs` alone won't do: the class rules are in the stylesheet either way.)
    expect(visibleHtml).toContain('id="g-test-graphic-desktop-g-ai0-1"');
    expect(html).not.toContain('id="g-test-graphic-desktop-g-ai0-1"');
  });

  it("skips a hidden png asset layer (no <img> for its asset)", () => {
    const raw = load("png-layer-overlay.json");
    const visibleHtml = emitHTML(processDocument(load("png-layer-overlay.json")).document).html;
    expect(visibleHtml).toContain("desktop-highlight.png");

    for (const layer of raw.artboards[0].layers as RawLayer[]) {
      if (layer.type === "png") layer.visible = false;
    }
    const { html } = emitHTML(processDocument(raw).document);
    expect(html).not.toContain("desktop-highlight.png");
  });

  it("skips hidden html-before / html-after hook layers", () => {
    const raw = load("escaping-adversarial.json");
    const visibleHtml = emitHTML(processDocument(load("escaping-adversarial.json")).document).html;
    expect(visibleHtml).toContain('data-hook="before"');
    expect(visibleHtml).toContain('data-hook="after"');

    for (const ab of raw.artboards) {
      for (const layer of ab.layers as RawLayer[]) {
        if (layer.type === "html-before" || layer.type === "html-after") {
          layer.visible = false;
        }
      }
    }
    const { html } = emitHTML(processDocument(raw).document);
    expect(html).not.toContain('data-hook="before"');
    expect(html).not.toContain('data-hook="after"');
  });

  it("skips a hidden svg layer and a hidden video layer", () => {
    const svgRaw = load("svg-layer-inline.json");
    for (const ab of svgRaw.artboards) {
      for (const layer of ab.layers as RawLayer[]) {
        if (layer.type === "svg") layer.visible = false;
      }
    }
    const svgHtml = emitHTML(processDocument(svgRaw).document).html;
    expect(svgHtml).not.toContain("<svg");

    const videoRaw = load("video-layer.json");
    for (const ab of videoRaw.artboards) {
      for (const layer of ab.layers as RawLayer[]) {
        if (layer.type === "video") layer.visible = false;
      }
    }
    const videoHtml = emitHTML(processDocument(videoRaw).document).html;
    expect(videoHtml).not.toContain("<video");
  });

  it("keeps rendering visible layers untouched", () => {
    const raw = load("png-layer-overlay.json");
    const { html } = emitHTML(processDocument(raw).document);
    expect(html).toContain("desktop-highlight.png");
  });
});
