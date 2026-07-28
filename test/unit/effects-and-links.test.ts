import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function loadAndProcess(name: string) {
  const raw = JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
  return processDocument(raw).document;
}

describe("Text effects", () => {
  it("deduplicates drop shadow effects into g-effect classes", () => {
    const doc = loadAndProcess("effects-and-links.json");
    const ab = doc.artboards[0];

    // Should have effect style classes
    expect(ab.effectStyleClasses.length).toBeGreaterThan(0);
    expect(ab.effectStyleClasses[0].className).toMatch(/^g-effect\d+$/);
  });

  it("generates text-shadow CSS for drop shadows", () => {
    const doc = loadAndProcess("effects-and-links.json");
    const ab = doc.artboards[0];

    const shadowEffect = ab.effectStyleClasses.find((e) => e.css.includes("text-shadow"));
    expect(shadowEffect).toBeDefined();
    expect(shadowEffect?.css).toContain("text-shadow: 2px 4px 3px");
    // The shared formatter drops trailing zeros: `0.5`, not `.toFixed(2)`'s `0.50`.
    expect(shadowEffect?.css).toContain("rgba(0,0,0,0.5)");
  });

  it("generates filter CSS for blur effects", () => {
    const doc = loadAndProcess("effects-and-links.json");
    const ab = doc.artboards[0];

    const blurEffect = ab.effectStyleClasses.find((e) => e.css.includes("filter"));
    expect(blurEffect).toBeDefined();
    expect(blurEffect?.css).toContain("filter: blur(4px)");
  });

  it("shares effect class between elements with same effect", () => {
    const doc = loadAndProcess("effects-and-links.json");
    const ab = doc.artboards[0];

    // Two elements have the same drop shadow — should share one class
    const shadowClasses = ab.effectStyleClasses.filter((e) => e.css.includes("text-shadow"));
    expect(shadowClasses).toHaveLength(1);
  });

  it("applies effect class to text element div in HTML output", () => {
    const doc = loadAndProcess("effects-and-links.json");
    const { html } = emitHTML(doc);

    // The shadow elements should have the effect class
    expect(html).toContain("g-effect");
    // Effect CSS should be in the style block
    expect(html).toContain("text-shadow:");
    expect(html).toContain("filter: blur(");
  });
});

describe("Hyperlinks", () => {
  it("renders hyperlink as <a> tag in HTML output", () => {
    const doc = loadAndProcess("effects-and-links.json");
    const { html } = emitHTML(doc);

    expect(html).toContain('<a href="https://example.com" target="_blank">');
    expect(html).toContain("here</span></a>");
  });

  it("does not wrap non-hyperlink runs in <a> tags", () => {
    const doc = loadAndProcess("effects-and-links.json");
    const { html } = emitHTML(doc);

    // "Click " and " for more info" should NOT be in <a> tags
    // Count the number of <a> tags — should be exactly 1
    const aTagCount = (html.match(/<a /g) || []).length;
    expect(aTagCount).toBe(1);
  });
});
