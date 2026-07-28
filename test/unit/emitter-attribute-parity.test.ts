import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { transformSync } from "esbuild";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { emitReact } from "../../src/emitters/react.js";
import { emitSvelte } from "../../src/emitters/svelte.js";
import type { EmitterReadyDocument, EmitterReadySnippetElement } from "../../src/ir/types.js";

/**
 * The same IR must render the same attribute *value* in all three emitters.
 *
 * React's attribute fast path emitted `name="value"` verbatim whenever the value
 * had no `"`, newline or brace — but JSX decodes character references in a
 * quoted attribute exactly like HTML does, so a value already containing
 * `&amp;` rendered as `&` in React and as `&amp;` in HTML and Svelte. Layer
 * names (`data-key`), `metadata.ariaRole` (`role`) and binding paths
 * (`data-binding-path`) all reach that path.
 *
 * Each emitter is measured after the parse/eval its consumer performs, not on
 * the source text: jsdom for HTML and for Svelte's markup (Svelte decodes
 * references the same way), and a real `createElement` call for React.
 */

const VALUES = [
  "A&amp;B",
  "A&B",
  "plain",
  "quote'apostrophe",
  "back`tick",
  "less<than>greater",
  "&lt;script&gt;",
  "&#x41;",
];

function docWithSnippet(key: string): EmitterReadyDocument {
  const ir = JSON.parse(readFileSync("test/fixtures/ir/single-artboard-basic.json", "utf-8"));
  const { document: doc } = processDocument(ir);
  const snippet: EmitterReadySnippetElement = {
    type: "snippet",
    key,
    position: { x: 0, y: 0, width: 100, height: 100 },
    computedPosition: { top: "10%", left: "5%", width: "90%" },
  };
  doc.artboards[0].layers[0].elements.push(snippet);
  return doc;
}

function attrFromMarkup(markup: string): string | null {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`);
  const node = dom.window.document.querySelector("[data-key]");
  return node ? node.getAttribute("data-key") : null;
}

/** The value React actually hands to the DOM, from a real `createElement` call. */
function attrFromReact(jsx: string): string | null {
  const cjs = transformSync(jsx, { loader: "jsx", jsx: "transform", format: "cjs" }).code;
  let found: string | null = null;
  const react = {
    useMemo: (factory: () => unknown) => factory(),
    Fragment: "fragment",
    createElement: (_type: unknown, props: Record<string, unknown> | null) => {
      if (props && typeof props["data-key"] === "string") found = props["data-key"] as string;
      return null;
    },
  };
  const sandbox: Record<string, unknown> = {
    module: { exports: {} },
    require: () => react,
  };
  sandbox.exports = (sandbox.module as { exports: unknown }).exports;
  createContext(sandbox);
  runInContext(cjs, sandbox);
  const component = (sandbox.module as { exports: { default: (p: unknown) => unknown } }).exports
    .default;
  component({});
  return found;
}

describe("attribute values render identically in every emitter", () => {
  for (const value of VALUES) {
    it(`agrees on data-key=${JSON.stringify(value)}`, () => {
      const doc = docWithSnippet(value);

      const html = attrFromMarkup(emitHTML(doc).html);
      // Svelte's spine element is real Svelte markup; its parser decodes
      // character references in attribute values as an HTML parser does.
      const svelteMarkup = emitSvelte(doc)
        .svelte.split("\n")
        .filter((line) => line.includes("data-key="))
        .join("\n");
      const svelte = attrFromMarkup(svelteMarkup);
      const react = attrFromReact(emitReact(doc).jsx);

      expect(html).toBe(value);
      expect(svelte).toBe(value);
      expect(react).toBe(value);
    });
  }
});
