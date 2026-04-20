import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

function processAndEmit(name: string) {
  const raw = loadFixture(name);
  const { document: doc, warnings } = processDocument(raw);
  const { html } = emitHTML(doc);
  return { html, doc, warnings };
}

describe("symbol layer rendering", () => {
  it("renders shapes as CSS divs", () => {
    const { html } = processAndEmit("symbol-layer.json");

    expect(html).toContain("g-symbol-layer");
    expect(html).toContain("g-aiSymbol");
    expect(html).toContain("border-radius:50%"); // circles
    expect(html).toContain('data-name="dot-1"');
    expect(html).toContain('data-name="dot-2"');
    expect(html).toContain('data-name="bar-1"');
    expect(html).toContain("background-color:rgb(255,0,0)"); // red dot
    expect(html).toContain("background-color:rgb(0,153,0)"); // green bar
  });

  it("applies opacity to shapes", () => {
    const { html } = processAndEmit("symbol-layer.json");
    expect(html).toContain("opacity:0.8"); // dot-2 at 80%
  });
});

describe("video layer rendering", () => {
  it("renders video element", () => {
    const { html } = processAndEmit("video-layer.json");

    expect(html).toContain("<video");
    expect(html).toContain("example.com/video.mp4");
    expect(html).toContain("autoplay");
    expect(html).toContain("muted");
    expect(html).toContain("loop");
    expect(html).toContain("playsinline");
    expect(html).toContain("object-fit:contain");
  });
});

describe("custom blocks", () => {
  it("injects CSS, JS, and HTML blocks", () => {
    const { html } = processAndEmit("custom-blocks.json");

    expect(html).toContain(".custom-class { color: red; }");
    expect(html).toContain("console.log('hello from ai2html');");
    expect(html).toContain('<div class="promo-banner">Breaking</div>');
    expect(html).toContain("<footer>Source: test</footer>");
  });

  it("includes accessibility attributes", () => {
    const { html } = processAndEmit("custom-blocks.json");

    expect(html).toContain("A test graphic with custom blocks");
    expect(html).toContain('role="img"');
    expect(html).toContain("aria-describedby");
  });
});

describe("character styles", () => {
  it("renders multiple character styles in one paragraph", () => {
    const { html } = processAndEmit("character-styles.json");

    // Should have spans for different styles
    expect(html).toContain("Normal ");
    expect(html).toContain("bold ");
    expect(html).toContain("italic ");
    expect(html).toContain("tracked ");
    expect(html).toContain("CAPS ");
    expect(html).toContain("super");
    expect(html).toContain("sub");
    // Character style classes should exist
    expect(html).toContain("g-cstyle");
  });

  it("generates correct CSS for character styles", () => {
    const { html } = processAndEmit("character-styles.json");

    // Bold should have font-weight: 700
    expect(html).toContain("font-weight: 700");
    // Italic should have font-style: italic
    expect(html).toContain("font-style: italic");
    // Tracking should have letter-spacing
    expect(html).toContain("letter-spacing: 0.1em");
    // Caps should have text-transform
    expect(html).toContain("text-transform: uppercase");
    // Super/subscript should have vertical-align
    expect(html).toContain("vertical-align: super");
    expect(html).toContain("vertical-align: sub");
  });
});
