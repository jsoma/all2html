import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { buildComponentTree } from "../../src/emitters/shared/component-tree.js";

function loadAndProcess(fixtureName: string) {
  const ir = JSON.parse(readFileSync(`test/fixtures/ir/${fixtureName}`, "utf-8"));
  return processDocument(ir);
}

describe("tagged text bindings", () => {
  const { document: doc } = loadAndProcess("tagged-text.json");

  describe("bindings found in the node tree", () => {
    it("collects bound text elements, sorted by path", () => {
      const { bindings } = buildComponentTree(doc);

      expect(bindings).toHaveLength(2);
      expect(bindings[0].path).toBe("content.body");
      expect(bindings[0].allowHtml).toBe(true);
      expect(bindings[1].path).toBe("headlines.main");
      expect(bindings[1].allowHtml).toBe(false);
    });

    it("carries the fallback paragraph class so bound text keeps its type styles", () => {
      const { bindings } = buildComponentTree(doc);
      for (const binding of bindings) {
        expect(binding.paragraphClassName).toMatch(/pstyle/);
      }
    });

    it("gates allowHtml through the allowUnsafeHtml emitter option", () => {
      const { bindings } = buildComponentTree(doc, undefined, { allowUnsafeHtml: false });
      expect(bindings.every((b) => b.allowHtml === false)).toBe(true);
    });

    it("does not treat unbound text as replaceable", () => {
      const { bindings, snippets } = buildComponentTree(doc);
      expect(snippets).toEqual([]);
      expect(bindings.map((b) => b.path)).not.toContain("static-main");
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
