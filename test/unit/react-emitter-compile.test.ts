import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitReact } from "../../src/emitters/react.js";
import type { EmitterReadyDocument, EmitterReadySnippetElement } from "../../src/ir/types.js";
import {
  COMPONENT_DEFAULT_OPTIONS,
  COMPONENT_EMITTER_OPTIONS,
  COMPONENT_FIXTURES,
  COMPONENT_STRUCTURAL_FIXTURES,
} from "../fixtures/component-fixtures.js";

function loadAndProcess(fixtureName: string): EmitterReadyDocument {
  const ir = JSON.parse(readFileSync(`test/fixtures/ir/${fixtureName}`, "utf-8"));
  return processDocument(ir).document;
}

/**
 * The React counterpart of `svelte-emitter-compile.test.ts`. The Svelte emitter
 * has always been checked against a real compiler; the React emitter never was,
 * and it now generates real JSX along the spine down to every snippet and
 * binding, so a malformed attribute or style object is a syntax error rather
 * than a component nobody notices is broken. esbuild is the parser because
 * `react` / `react-dom` are not installed here — only the syntax is under test.
 */
function parse(source: string, loader: "jsx" | "tsx"): void {
  transformSync(source, { loader, jsx: "preserve", sourcefile: `Graphic.${loader}` });
}

/** Parses both output flavours; a syntax error in either fails the fixture. */
function expectParses(fixture: string, options: Record<string, unknown> | undefined): void {
  const doc = loadAndProcess(fixture);
  expect(() => parse(emitReact(doc, undefined, options).jsx, "jsx")).not.toThrow();
  expect(() =>
    parse(emitReact(doc, undefined, { ...options, typescript: true }).jsx, "tsx"),
  ).not.toThrow();
}

// Shared with `svelte-emitter-compile.test.ts` so the two emitters can never be
// checked against different corpora again — that divergence is what hid a Svelte
// compile failure on `escaping-adversarial.json`, a fixture this list had.
describe("React emitter output parses as JSX", () => {
  it("sweeps structural fixtures that all exist in the corpus", () => {
    // Guards the option sweep below against silently narrowing to nothing if a
    // fixture is renamed or removed.
    for (const fixture of COMPONENT_STRUCTURAL_FIXTURES) {
      expect(COMPONENT_FIXTURES, fixture).toContain(fixture);
    }
  });

  // The fixture axis stays whole: it is what found the Svelte `:global` bug.
  for (const fixture of COMPONENT_FIXTURES) {
    it(`parses ${fixture} with ${COMPONENT_DEFAULT_OPTIONS.label}`, () => {
      expectParses(fixture, COMPONENT_DEFAULT_OPTIONS.options);
    });
  }

  // The option axis is swept only where it can change the emitted spine.
  for (const fixture of COMPONENT_STRUCTURAL_FIXTURES) {
    for (const { label, options } of COMPONENT_EMITTER_OPTIONS) {
      it(`parses ${fixture} with ${label}`, () => {
        expectParses(fixture, options);
      });
    }
  }
});

describe("React snippets and bindings are real props", () => {
  it("turns snippet placeholders into ReactNode props rendered in place", () => {
    const doc = loadAndProcess("snippet-layer.json");
    const { jsx } = emitReact(doc, undefined, { typescript: true });

    expect(jsx).toContain("chart?: ReactNode;");
    expect(jsx).toContain("footer?: ReactNode;");
    expect(jsx).toContain('import type { JSX, ReactNode } from "react";');
    // Rendered inside the placeholder, which is now a real JSX element.
    expect(jsx).toMatch(/data-key="chart"[^>]*>\{chart\}</);
    expect(jsx).toMatch(/data-key="footer"[^>]*>\{footer\}</);
    // The rest of the artboard is still one innerHTML chunk.
    expect(jsx).toContain("dangerouslySetInnerHTML");
    expect(() => parse(jsx, "tsx")).not.toThrow();
  });

  it("keeps the plain JSX import list unchanged when there are no snippets", () => {
    const { jsx } = emitReact(loadAndProcess("single-artboard-basic.json"), undefined, {
      typescript: true,
    });
    expect(jsx).toContain('import type { JSX } from "react";');
    expect(jsx).not.toContain("ReactNode");
  });

  it("turns bound text into a bindings prop with the design-file text as fallback", () => {
    const { jsx } = emitReact(loadAndProcess("tagged-text.json"), undefined, {
      typescript: true,
    });

    expect(jsx).toContain("bindings?: Record<string, string>;");
    expect(jsx).toContain('{bindings["headlines.main"] != null ? (');
    // Type styles survive: the bound value is re-wrapped in the original <p> class.
    expect(jsx).toContain('<p className="g-pstyle1">{bindings["headlines.main"]}</p>');
    // allowHtml bindings go through dangerouslySetInnerHTML, plain ones do not.
    expect(jsx).toContain('dangerouslySetInnerHTML={{ __html: bindings["content.body"] }}');
    expect(() => parse(jsx, "tsx")).not.toThrow();
  });

  it("honors allowUnsafeHtml: false for bindings", () => {
    const { jsx } = emitReact(loadAndProcess("tagged-text.json"), undefined, {
      allowUnsafeHtml: false,
    });
    expect(jsx).not.toContain('__html: bindings["content.body"]');
    expect(jsx).toContain('<p className="g-pstyle0">{bindings["content.body"]}</p>');
  });
});

describe("React style attributes become style objects", () => {
  function withSnippet(doc: EmitterReadyDocument): EmitterReadyDocument {
    const snippet: EmitterReadySnippetElement = {
      type: "snippet",
      key: "chart",
      position: { x: 0, y: 0, width: 100, height: 100 },
      computedPosition: { top: "10%", left: "5%", width: "90%" },
    };
    const clone = structuredClone(doc);
    clone.artboards[0].layers[0].elements.push(snippet);
    return clone;
  }

  it("converts inline position styles into a React style object", () => {
    const { jsx } = emitReact(withSnippet(loadAndProcess("snippet-layer.json")));
    expect(jsx).toContain('style={{ top: "10%", left: "5%", width: "90%" }}');
  });

  it("keeps CSS custom properties verbatim and threads the asset path through", () => {
    // The container carries `--{artboard}-img: url(...)` in css-var mode, and the
    // URL contains the asset token. It only reaches real JSX when the container
    // is on the spine to a replaceable, which is what the injected snippet forces.
    const doc = withSnippet(loadAndProcess("multi-artboard-responsive.json"));
    const { jsx } = emitReact(doc, undefined, { responsiveImageMode: "css-var" });

    expect(jsx).toMatch(/"--mobile-img": `url\("\$\{safePath\}\/[^`]*"\)`/);
    expect(jsx).not.toContain("__ALL2HTML_ASSETS__/mobile");
    expect(() => parse(jsx, "jsx")).not.toThrow();
  });
});
