import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { extractReplaceableNodes } from "../../src/emitters/shared/replaceable-nodes.js";

function loadAndProcess(fixtureName: string) {
  const ir = JSON.parse(readFileSync(`test/fixtures/ir/${fixtureName}`, "utf-8"));
  return processDocument(ir);
}

describe("tagged text bindings", () => {
  const { document: doc } = loadAndProcess("tagged-text.json");

  describe("extractReplaceableNodes", () => {
    it("extracts binding nodes from text elements", () => {
      const nodes = extractReplaceableNodes(doc);
      const bindings = nodes.filter((n) => n.type === "binding");

      expect(bindings).toHaveLength(2);
      expect(bindings[0].bindingPath).toBe("headlines.main");
      expect(bindings[0].allowHtml).toBe(false);
      expect(bindings[0].fallbackText).toBe("Default Headline");

      expect(bindings[1].bindingPath).toBe("content.body");
      expect(bindings[1].allowHtml).toBe(true);
      expect(bindings[1].fallbackText).toBe("Default body text");
    });

    it("does not extract unbound text elements", () => {
      const nodes = extractReplaceableNodes(doc);
      // Static text (no binding) should not appear
      expect(nodes.every((n) => n.elementId !== "binding-static-main")).toBe(true);
    });
  });

  describe("HTML emitter binding markers", () => {
    it("adds data-replaceable and data-binding-path to bound elements", () => {
      const { html } = emitHTML(doc);
      expect(html).toContain('data-replaceable="binding"');
      expect(html).toContain('data-binding-path="headlines.main"');
      expect(html).toContain('data-binding-path="content.body"');
    });

    it("adds data-binding-html for allowHtml bindings", () => {
      const { html } = emitHTML(doc);
      // The body binding has allowHtml: true
      expect(html).toContain('data-binding-html="true"');
    });

    it("suppresses data-binding-html when allowUnsafeHtml is false", () => {
      const { html } = emitHTML(doc, undefined, { allowUnsafeHtml: false });
      expect(html).not.toContain('data-binding-html="true"');
    });

    it("does not add binding markers to unbound text", () => {
      const { html } = emitHTML(doc);
      // Static text should not have data-replaceable
      expect(html).not.toMatch(/id="g-static"[^>]*data-replaceable/);
    });

    it("still renders static text content for bound elements", () => {
      const { html } = emitHTML(doc);
      // Bound elements should still have their placeholder text rendered
      expect(html).toContain("Default Headline");
      expect(html).toContain("Default body text");
    });
  });
});
