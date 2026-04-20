import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { emitReact } from "../../src/emitters/react.js";
import { emitStandalone } from "../../src/emitters/standalone.js";
import { emitSvelte } from "../../src/emitters/svelte.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function loadAndProcess(name: string) {
  const raw = JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
  return processDocument(raw).document;
}

describe("Svelte emitter", () => {
  it("produces valid Svelte component with $props", () => {
    const doc = loadAndProcess("single-artboard-basic.json");
    const { svelte } = emitSvelte(doc);

    expect(svelte).toContain("<script>");
    expect(svelte).toContain("$props()");
    expect(svelte).toContain("assetsPath");
    expect(svelte).toContain("{@html");
    expect(svelte).toContain("Headline Text Here");
  });

  it("has CSS in a style block", () => {
    const doc = loadAndProcess("single-artboard-basic.json");
    const { svelte } = emitSvelte(doc);
    const styleCount = (svelte.match(/<style>/g) || []).length;
    expect(styleCount).toBe(1);
  });

  it("uses runtime asset path replacement", () => {
    const doc = loadAndProcess("single-artboard-basic.json");
    const { svelte } = emitSvelte(doc);
    // Should use token-based replacement, not Svelte template interpolation in HTML strings
    expect(svelte).toContain("resolveHtml");
    expect(svelte).toContain("ASSET_TOKEN");
  });

  it("handles multi-artboard responsive", () => {
    const doc = loadAndProcess("multi-artboard-responsive.json");
    const { svelte } = emitSvelte(doc);
    expect(svelte).toContain("container-type: inline-size");
    expect(svelte).toContain("Mobile Title");
    expect(svelte).toContain("Desktop Title");
  });

  it("threads shared emitter options into generated markup", () => {
    const doc = loadAndProcess("tagged-text.json");
    const { svelte } = emitSvelte(doc, undefined, { allowUnsafeHtml: false });
    expect(svelte).not.toContain('data-binding-html="true"');
  });
});

describe("React emitter", () => {
  it("produces valid JSX component", () => {
    const doc = loadAndProcess("single-artboard-basic.json");
    const { jsx } = emitReact(doc);

    expect(jsx).toContain("import React");
    expect(jsx).toContain("export default function");
    expect(jsx).toContain("assetsPath");
    expect(jsx).toContain("Headline Text Here");
  });

  it("does NOT convert class to className in HTML string", () => {
    const doc = loadAndProcess("single-artboard-basic.json");
    const { jsx } = emitReact(doc);
    // The HTML is injected via dangerouslySetInnerHTML — it must use standard HTML attributes
    expect(jsx).toContain('class="ai2html"');
    expect(jsx).not.toMatch(/className="ai2html"/);
  });

  it("uses runtime asset path replacement via useMemo", () => {
    const doc = loadAndProcess("single-artboard-basic.json");
    const { jsx } = emitReact(doc);
    expect(jsx).toContain("useMemo");
    expect(jsx).toContain("ASSET_TOKEN");
  });

  it("supports shared emitter options alongside React-specific ones", () => {
    const doc = loadAndProcess("tagged-text.json");
    const { jsx } = emitReact(doc, undefined, {
      allowUnsafeHtml: false,
      typescript: true,
    });
    expect(jsx).not.toContain('data-binding-html="true"');
    expect(jsx).toContain("interface");
  });
});

describe("Standalone emitter", () => {
  it("produces full HTML document", () => {
    const doc = loadAndProcess("single-artboard-basic.json");
    const { html } = emitStandalone(doc);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
    expect(html).toContain("Headline Text Here");
  });

  it("uses metadata.lang when present", () => {
    const doc = loadAndProcess("single-artboard-basic.json");
    doc.metadata.lang = "ja";
    const { html } = emitStandalone(doc);
    expect(html).toContain('<html lang="ja">');
  });
});
