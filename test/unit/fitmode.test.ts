import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { generateCSS } from "../../src/emitters/shared/css.js";

function loadAndProcess(fixtureName: string) {
  const ir = JSON.parse(readFileSync(`test/fixtures/ir/${fixtureName}`, "utf-8"));
  return processDocument(ir);
}

describe("fitMode", () => {
  describe("width mode (default)", () => {
    it("uses standard maxWidth and centering", () => {
      const ir = JSON.parse(
        readFileSync("test/fixtures/ir/multi-artboard-responsive.json", "utf-8"),
      );
      ir.settings.maxWidth = 960;
      ir.settings.centerHtmlOutput = true;
      const { document: doc } = processDocument(ir);
      const { css } = generateCSS(doc, { fitMode: "width" });

      expect(css).toContain("max-width: 960px");
      expect(css).toContain("margin: 0 auto");
    });

    it("uses background-size: 100% for CSS var images", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const { css } = generateCSS(doc, { fitMode: "width", responsiveImageMode: "css-var" });
      expect(css).toContain("background-size: 100%");
    });
  });

  describe("height mode", () => {
    it("sets container height: 100%", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const { css } = generateCSS(doc, { fitMode: "height" });
      expect(css).toContain("height: 100%");
    });

    it("uses background-size: contain", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const { css } = generateCSS(doc, { fitMode: "height", responsiveImageMode: "css-var" });
      expect(css).toContain("background-size: contain");
    });

    it("preserves maxWidth", () => {
      const ir = JSON.parse(
        readFileSync("test/fixtures/ir/multi-artboard-responsive.json", "utf-8"),
      );
      ir.settings.maxWidth = 800;
      const { document: doc } = processDocument(ir);
      const { css } = generateCSS(doc, { fitMode: "height" });
      expect(css).toContain("max-width: 800px");
    });

    it("applies horizontal centering only", () => {
      const ir = JSON.parse(
        readFileSync("test/fixtures/ir/multi-artboard-responsive.json", "utf-8"),
      );
      ir.settings.centerHtmlOutput = true;
      const { document: doc } = processDocument(ir);
      const { css } = generateCSS(doc, { fitMode: "height" });
      expect(css).toContain("margin: 0 auto");
    });
  });

  describe("cover mode", () => {
    it("sets container width and height to 100% with overflow hidden", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const { css } = generateCSS(doc, { fitMode: "cover" });
      expect(css).toContain("width: 100%");
      expect(css).toContain("height: 100%");
      expect(css).toContain("overflow: hidden");
    });

    it("uses background-size: cover", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const { css } = generateCSS(doc, { fitMode: "cover", responsiveImageMode: "css-var" });
      expect(css).toContain("background-size: cover");
    });

    it("ignores maxWidth setting on container", () => {
      const ir = JSON.parse(
        readFileSync("test/fixtures/ir/multi-artboard-responsive.json", "utf-8"),
      );
      ir.settings.maxWidth = 800;
      const { document: doc } = processDocument(ir);
      const { css } = generateCSS(doc, { fitMode: "cover" });
      // Container should not have maxWidth, but artboard-level max-width (from breakpoints) is fine
      expect(css).not.toContain("max-width: 800px");
    });

    it("ignores centering", () => {
      const ir = JSON.parse(
        readFileSync("test/fixtures/ir/multi-artboard-responsive.json", "utf-8"),
      );
      ir.settings.centerHtmlOutput = true;
      const { document: doc } = processDocument(ir);
      const { css } = generateCSS(doc, { fitMode: "cover" });
      expect(css).not.toContain("margin: 0 auto");
    });
  });

  describe("default behavior", () => {
    it("defaults to width mode when no fitMode specified", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const { css: defaultCss } = generateCSS(doc);
      const { css: widthCss } = generateCSS(doc, { fitMode: "width" });
      expect(defaultCss).toBe(widthCss);
    });
  });
});
