import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function processAndEmitFixture(name: string) {
  const raw = JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
  const { document: doc, warnings } = processDocument(raw);
  const { html } = emitHTML(doc);
  return { doc, html, warnings };
}

describe("font mapping", () => {
  it("resolves custom fonts from IR config", () => {
    const { html, warnings } = processAndEmitFixture("font-mapping.json");
    expect(html).toContain("'My Custom Font', sans-serif");
    expect(html).toContain("font-weight: 700"); // bold mapping
    // Unknown font should generate a warning
    expect(warnings.some((w) => w.includes("SomeUnknownFont"))).toBe(true);
  });
});

describe("text alignment matrix", () => {
  it("positions all 9 alignment combos correctly", () => {
    const { html } = processAndEmitFixture("text-alignment-matrix.json");
    // Left-aligned: should have left: X%
    expect(html).toContain("Left Top");
    expect(html).toContain("Left Middle");
    expect(html).toContain("Left Bottom");
    // Right-aligned: should have right: X%
    expect(html).toContain("Right Top");
    expect(html).toContain("right:");
    // Center-aligned: should have left: X% + margin-left
    expect(html).toContain("Center Top");
    expect(html).toContain("margin-left:");
    // Bottom-aligned: should have bottom: X%
    expect(html).toContain("Left Bottom");
    expect(html).toContain("bottom:");
    // Middle-aligned: should have margin-top (negative)
    expect(html).toContain("margin-top:");
  });
});

describe("color snapping", () => {
  it("snaps near-black to pure black", () => {
    const { html } = processAndEmitFixture("color-snapping.json");
    expect(html).toContain("rgb(0,0,0)");
    expect(html).not.toContain("rgb(20,20,20)");
  });
});

describe("empty paragraphs", () => {
  it("renders empty paragraphs as nbsp", () => {
    const { html } = processAndEmitFixture("empty-paragraphs.json");
    expect(html).toContain("&nbsp;");
    expect(html).toContain("Line 1");
    expect(html).toContain("Line 3");
  });
});

describe("clickable link", () => {
  it("wraps graphic in anchor tag", () => {
    const { html } = processAndEmitFixture("clickable-link.json");
    expect(html).toContain('<a class="g-ai2htmlLink"');
    expect(html).toContain('href="https://example.com"');
  });
});

describe("alt text and accessibility", () => {
  it("includes alt text and aria attributes", () => {
    const { html } = processAndEmitFixture("alt-text.json");
    expect(html).toContain("A chart showing population growth");
    expect(html).toContain("aria-describedby");
    expect(html).toContain('role="img"');
    expect(html).toContain("g-aiAltText");
  });
});

describe("aspect ratio", () => {
  it("emits aspect-ratio CSS for dynamic artboards", () => {
    const { html } = processAndEmitFixture("aspect-ratio-shim.json");
    expect(html).toContain("aspect-ratio:");
    // Also has padding shim
    expect(html).toContain("padding:0 0");
  });
});

describe("SVG inline layer", () => {
  it("renders inline SVG content", () => {
    const { html } = processAndEmitFixture("svg-layer-inline.json");
    expect(html).toContain("<svg");
    expect(html).toContain("<circle");
    expect(html).toContain('fill="red"');
  });
});

describe("PNG overlay layer", () => {
  it("renders PNG overlay image", () => {
    const { html } = processAndEmitFixture("png-layer-overlay.json");
    expect(html).toContain("desktop-highlight.png");
    expect(html).toContain("opacity:0.7");
  });
});

describe("shape positioning", () => {
  it("circles get border-radius 50%", () => {
    const { html } = processAndEmitFixture("symbol-layer.json");
    expect(html).toContain("border-radius:50%");
  });

  it("rectangles do not get border-radius", () => {
    const { html } = processAndEmitFixture("symbol-layer.json");
    // bar-1 is a rectangle — check it doesn't have border-radius
    const barSection = html.split('data-name="bar-1"')[1]?.split("</div>")[0] || "";
    expect(barSection).not.toContain("border-radius");
  });
});

describe("style deduplication", () => {
  it("selects body text as base style (most chars)", () => {
    const { html } = processAndEmitFixture("style-dedup-many.json");
    // Body text (ArialMT 14px) should be the base <p> style
    // Headlines and captions should have g-pstyle classes
    expect(html).toContain("g-pstyle0");
    // Base style should be the body text (most common by char count)
    const baseStyleMatch = html.match(/#g-style-dedup-test-desktop p \{([^}]+)\}/);
    expect(baseStyleMatch).toBeTruthy();
    expect(baseStyleMatch?.[1]).toContain("font-size: 14px");
  });
});

describe("mixed responsiveness", () => {
  it("dynamic artboard gets aspect-ratio, fixed does not", () => {
    const { html } = processAndEmitFixture("mixed-responsiveness.json");
    // Mobile (dynamic) should have aspect-ratio
    expect(html).toContain("aspect-ratio: 320 / 500");
    // Desktop (fixed) should NOT have aspect-ratio
    expect(html).not.toContain("aspect-ratio: 1000 / 600");
    // Desktop should have fixed width/height
    expect(html).toContain("width:1000px");
    expect(html).toContain("height:600px");
  });
});
