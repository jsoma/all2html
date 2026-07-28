import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { buildComponentTree } from "../../src/emitters/shared/component-tree.js";
import { el, type HtmlNode } from "../../src/emitters/shared/html-node.js";
import {
  collectReplaceables,
  readReplaceableMarker,
  segmentTree,
  snippetPropName,
} from "../../src/emitters/shared/replaceable-nodes.js";

function loadAndProcess(fixtureName: string) {
  const ir = JSON.parse(readFileSync(`test/fixtures/ir/${fixtureName}`, "utf-8"));
  return processDocument(ir);
}

describe("replaceable nodes", () => {
  describe("finding placeholders in the node tree", () => {
    it("collects snippet placeholders from the built tree", () => {
      const { document: doc } = loadAndProcess("snippet-layer.json");
      const { snippets } = buildComponentTree(doc);

      expect(snippets.map((s) => s.key)).toEqual(["chart", "footer"]);
      expect(snippets.map((s) => s.propName)).toEqual(["chart", "footer"]);
    });

    it("collects nothing when the document has no replaceables", () => {
      const { document: doc } = loadAndProcess("single-artboard-basic.json");
      const tree = buildComponentTree(doc);
      expect(tree.snippets).toEqual([]);
      expect(tree.bindings).toEqual([]);
    });

    it("reads the marker off a placeholder element", () => {
      const node = el("div", [
        ["class", "g-aiAbs"],
        ["data-replaceable", "snippet"],
        ["data-key", "chart"],
      ]);
      expect(readReplaceableMarker(node)).toEqual({
        type: "snippet",
        key: "chart",
        propName: "chart",
      });
    });

    it("ignores elements without a marker", () => {
      expect(readReplaceableMarker(el("div", [["class", "g-aiAbs"]]))).toBeNull();
    });
  });

  describe("snippetPropName", () => {
    it("sanitizes layer-derived keys into JS identifiers", () => {
      expect(snippetPropName("chart")).toBe("chart");
      expect(snippetPropName("my chart-2")).toBe("my_chart_2");
      expect(snippetPropName("2024")).toBe("_2024");
      expect(snippetPropName("")).toBe("_");
    });

    it("keeps clear of the props the components already declare", () => {
      expect(snippetPropName("assetsPath")).toBe("assetsPath_");
      expect(snippetPropName("className")).toBe("className_");
      expect(snippetPropName("bindings")).toBe("bindings_");
    });
  });

  describe("segmentTree", () => {
    const snippet = (key: string): HtmlNode =>
      el("div", [
        ["data-replaceable", "snippet"],
        ["data-key", key],
      ]);

    it("returns one opaque markup segment when nothing is replaceable", () => {
      const segments = segmentTree([el("div", [], [el("p", [], [])]), el("span", [], [])]);
      expect(segments).toHaveLength(1);
      expect(segments[0].kind).toBe("markup");
    });

    it("reconstructs only the spine down to a placeholder", () => {
      const tree = [
        el("div", [["id", "box"]], [el("p", [], []), snippet("chart"), el("p", [], [])]),
      ];
      const segments = segmentTree(tree);
      expect(segments.map((s) => s.kind)).toEqual(["host"]);
      const host = segments[0];
      if (host.kind !== "host") throw new Error("expected host segment");
      expect(host.children.map((s) => s.kind)).toEqual(["markup", "replaceable", "markup"]);
    });

    it("renames distinct keys that would collapse onto one prop name", () => {
      const segments = segmentTree([el("div", [], [snippet("my chart"), snippet("my-chart")])]);
      const { snippets, propNameRenames } = collectReplaceables(segments);
      expect(snippets.map((s) => s.propName)).toEqual(["my_chart", "my_chart_"]);
      expect(propNameRenames).toEqual([
        { key: "my-chart", propName: "my_chart_", reason: "collision" },
      ]);
    });

    it("gives every placeholder for one key the same prop name", () => {
      const segments = segmentTree([el("div", [], [snippet("chart"), snippet("chart")])]);
      const { snippets, propNameRenames } = collectReplaceables(segments);
      expect(snippets.map((s) => s.propName)).toEqual(["chart"]);
      expect(propNameRenames).toEqual([]);
    });

    it("assigns names in document order, so output is deterministic", () => {
      const forward = collectReplaceables(
        segmentTree([el("div", [], [snippet("a b"), snippet("a-b")])]),
      );
      const reverse = collectReplaceables(
        segmentTree([el("div", [], [snippet("a-b"), snippet("a b")])]),
      );
      expect(forward.propNameRenames[0].key).toBe("a-b");
      expect(reverse.propNameRenames[0].key).toBe("a b");
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
            if (el.type === "snippet") {
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
