import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import {
  extractReplaceableNodes,
  getSnippetKeys,
} from "../../src/emitters/shared/replaceable-nodes.js";

function loadAndProcess(fixtureName: string) {
  const ir = JSON.parse(readFileSync(`test/fixtures/ir/${fixtureName}`, "utf-8"));
  return processDocument(ir);
}

describe("replaceable nodes", () => {
  describe("extractReplaceableNodes", () => {
    it("extracts snippet elements from processed document", () => {
      const { document: doc } = loadAndProcess("snippet-layer.json");
      const nodes = extractReplaceableNodes(doc);

      const snippets = nodes.filter((n) => n.type === "snippet");
      expect(snippets).toHaveLength(2);
      expect(snippets[0].key).toBe("chart");
      expect(snippets[0].artboardName).toBe("mobile");
      expect(snippets[0].position).toBeDefined();
      expect(snippets[1].key).toBe("footer");
    });

    it("returns empty array when no replaceable nodes exist", () => {
      const { document: doc } = loadAndProcess("single-artboard-basic.json");
      const nodes = extractReplaceableNodes(doc);
      expect(nodes).toHaveLength(0);
    });
  });

  describe("getSnippetKeys", () => {
    it("returns unique sorted snippet keys", () => {
      const { document: doc } = loadAndProcess("snippet-layer.json");
      const nodes = extractReplaceableNodes(doc);
      const keys = getSnippetKeys(nodes);
      expect(keys).toEqual(["chart", "footer"]);
    });
  });

  describe("HTML emitter snippet rendering", () => {
    it("renders snippet elements as positioned empty divs", () => {
      const { document: doc } = loadAndProcess("snippet-layer.json");
      const { html } = emitHTML(doc);

      expect(html).toContain('data-replaceable="snippet"');
      expect(html).toContain('data-key="chart"');
      expect(html).toContain('data-key="footer"');
      expect(html).toContain("g-aiAbs");
    });

    it("includes position styles on snippet divs", () => {
      const { document: doc } = loadAndProcess("snippet-layer.json");
      const { html } = emitHTML(doc);

      // Snippet should have top/left/width percentage styles
      expect(html).toMatch(/data-key="chart"[^>]*style="[^"]*top:/);
      expect(html).toMatch(/data-key="chart"[^>]*style="[^"]*left:/);
    });
  });

  describe("pipeline handles snippet elements", () => {
    it("computes positions for snippet elements", () => {
      const { document: doc } = loadAndProcess("snippet-layer.json");
      let foundSnippet = false;

      for (const ab of doc.artboards) {
        for (const layer of ab.layers) {
          for (const el of layer.elements) {
            if (el.type === "snippet" && "computedPosition" in el) {
              foundSnippet = true;
              expect(el.computedPosition.top).toBeDefined();
              expect(el.computedPosition.left).toBeDefined();
              expect(el.computedPosition.width).toBeDefined();
            }
          }
        }
      }
      expect(foundSnippet).toBe(true);
    });
  });
});
