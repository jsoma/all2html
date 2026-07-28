import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { emitReact } from "../../src/emitters/react.js";
import { emitSvelte } from "../../src/emitters/svelte.js";

function loadAndProcess(fixtureName: string) {
  const ir = JSON.parse(readFileSync(`test/fixtures/ir/${fixtureName}`, "utf-8"));
  return processDocument(ir);
}

describe("CSS custom property image loading", () => {
  const { document: doc } = loadAndProcess("multi-artboard-responsive.json");

  it("uses <img> backgrounds by default for multi-artboard responsive documents", () => {
    const { html } = emitHTML(doc);
    expect(html).toContain("<img");
    expect(html).not.toContain("background-image: var(");
    expect(html).not.toContain("--mobile-img:url(");
  });

  it("uses CSS custom properties when responsiveImageMode is css-var", () => {
    const { html } = emitHTML(doc, undefined, { responsiveImageMode: "css-var" });
    // Container div should have CSS custom property declarations
    expect(html).toContain("--mobile-img:url(");
    expect(html).toContain("--tablet-img:url(");
    expect(html).toContain("--desktop-img:url(");
    expect(html).not.toContain("&#x27;");
  });

  it("quotes css-var asset urls so paths with spaces remain valid", () => {
    const cloned = structuredClone(doc);
    cloned.settings.cacheBustToken = 7;
    cloned.assets["bg-mobile"].path = "all2html-output/mobile hero (1).png";

    const { html } = emitHTML(cloned, undefined, { responsiveImageMode: "css-var" });

    expect(html).toContain("--mobile-img:url(&quot;all2html-output/mobile hero (1).png?v=7&quot;)");
  });

  it("emits background-image: var() in CSS container queries", () => {
    const { html } = emitHTML(doc, undefined, { responsiveImageMode: "css-var" });
    // CSS should reference the custom properties via var()
    expect(html).toContain("background-image: var(--mobile-img)");
    expect(html).toContain("background-image: var(--desktop-img)");
    expect(html).toContain("background-image: var(--tablet-img)");
  });

  it("adds background-size and height to .g-aiImg when using CSS vars", () => {
    const { html } = emitHTML(doc, undefined, { responsiveImageMode: "css-var" });
    expect(html).toContain("background-size: 100%");
    expect(html).toContain("background-position: center");
    expect(html).toContain("height: 100%");
  });

  it("uses <div> instead of <img> for artboard backgrounds", () => {
    const { html } = emitHTML(doc, undefined, { responsiveImageMode: "css-var" });
    // Should NOT have <img> tags for artboard backgrounds
    expect(html).not.toMatch(/<img[^>]*class="g-aiImg"[^>]*src="/);
    // Should have <div> tags with role="img"
    expect(html).toContain('role="img"');
    expect(html).toContain('class="g-aiImg"');
  });

  it("adds aria-label for accessibility", () => {
    const { html } = emitHTML(doc, undefined, { responsiveImageMode: "css-var" });
    // Each artboard background should have aria-label
    expect(html).toContain('aria-label="mobile"');
    expect(html).toContain('aria-label="tablet"');
    expect(html).toContain('aria-label="desktop"');
  });

  /**
   * `Asset.altText` describes one image; `metadata.imageAltText` describes the
   * whole document. Illustrator only ever sets the document-level one (from
   * `image_alt_text` in the settings block), so it has to keep applying to
   * every background; the SVG importer sets the per-asset one, which has to win
   * so two rasterized graphics in one document cannot be given the same label.
   */
  describe("background image alt text", () => {
    function withAltText(assetAltText: Record<string, string>, documentAltText?: string) {
      const cloned = structuredClone(doc);
      if (documentAltText !== undefined) cloned.metadata.imageAltText = documentAltText;
      for (const [assetId, altText] of Object.entries(assetAltText)) {
        cloned.assets[assetId].altText = altText;
      }
      return cloned;
    }

    it("applies metadata.imageAltText to every background — the Illustrator path", () => {
      const { html } = emitHTML(withAltText({}, "Chart of the whole thing"));
      expect(html.match(/alt="Chart of the whole thing"/g)).toHaveLength(3);
      expect(html).not.toContain('alt=""');
    });

    it("prefers the asset's own alt text over the document-level one", () => {
      const { html } = emitHTML(
        withAltText({ "bg-mobile": "Small screen chart" }, "Chart of the whole thing"),
      );
      expect(html).toContain('alt="Small screen chart"');
      // The other two backgrounds still fall back to the document-level value.
      expect(html.match(/alt="Chart of the whole thing"/g)).toHaveLength(2);
    });

    it("gives each asset its own label with no document-level value at all", () => {
      const { html } = emitHTML(
        withAltText({ "bg-mobile": "Small screen chart", "bg-desktop": "Wide chart" }),
      );
      expect(html).toContain('alt="Small screen chart"');
      expect(html).toContain('alt="Wide chart"');
      // bg-tablet has neither, so it keeps the empty alt a decorative image gets.
      expect(html).toContain('alt=""');
    });

    it("uses the same precedence for the css-var aria-label, artboard name last", () => {
      const { html } = emitHTML(
        withAltText({ "bg-mobile": "Small screen chart" }, "Chart of the whole thing"),
        undefined,
        { responsiveImageMode: "css-var" },
      );
      expect(html).toContain('aria-label="Small screen chart"');
      expect(html.match(/aria-label="Chart of the whole thing"/g)).toHaveLength(2);
      expect(html).not.toContain('aria-label="mobile"');

      const { html: bare } = emitHTML(
        withAltText({ "bg-mobile": "Small screen chart" }),
        undefined,
        {
          responsiveImageMode: "css-var",
        },
      );
      expect(bare).toContain('aria-label="Small screen chart"');
      expect(bare).toContain('aria-label="tablet"');
      expect(bare).toContain('aria-label="desktop"');
    });
  });

  it("keeps <img> tags for PNG/SVG overlay layers", () => {
    // Load a fixture that has both background and overlay layers
    const ir = JSON.parse(readFileSync("test/fixtures/ir/png-layer-overlay.json", "utf-8"));
    const { document: overlayDoc } = processDocument(ir);
    const { html } = emitHTML(overlayDoc);
    // Single artboard docs should still use <img> (no CSS var mode)
    expect(html).toContain("<img");
  });

  it("does NOT use CSS vars for single-artboard documents", () => {
    const { document: singleDoc } = loadAndProcess("single-artboard-basic.json");
    const { html } = emitHTML(singleDoc);
    // Should use <img> tags, not CSS custom properties
    expect(html).toContain("<img");
    expect(html).not.toContain("background-image: var(");
    expect(html).not.toContain('role="img"');
  });

  it("token replacement works in url() context for Svelte", () => {
    const { svelte } = emitSvelte(doc, undefined, { responsiveImageMode: "css-var" });
    // The CSS vars should have asset token for runtime replacement
    expect(svelte).toContain("__ALL2HTML_ASSETS__");
    // The url() values should be tokenized
    expect(svelte).toContain("url(");
  });

  it("token replacement works in url() context for React", () => {
    const { jsx } = emitReact(doc, undefined, { responsiveImageMode: "css-var" });
    expect(jsx).toContain("__ALL2HTML_ASSETS__");
    expect(jsx).toContain("url(");
  });
});
