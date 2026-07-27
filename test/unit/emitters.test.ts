import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitReact } from "../../src/emitters/react.js";
import { emitStandalone, emitStandaloneGroup } from "../../src/emitters/standalone.js";
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

  it("preserves Google Fonts import and link modes", () => {
    const importDoc = loadAndProcess("single-artboard-basic.json");
    importDoc.settings.googleFonts = "import";
    importDoc.fonts = [
      { sourceFont: "Inter-Regular", family: "Inter,system-ui,sans-serif", weight: "400" },
    ];
    expect(emitSvelte(importDoc).svelte).toContain(
      '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap");',
    );

    const linkDoc = loadAndProcess("single-artboard-basic.json");
    linkDoc.settings.googleFonts = "link";
    linkDoc.fonts = [
      { sourceFont: "Inter-Regular", family: "Inter,system-ui,sans-serif", weight: "400" },
    ];
    const { svelte } = emitSvelte(linkDoc);
    expect(svelte).toContain("<svelte:head>");
    expect(svelte).toContain(
      'href="https://fonts.googleapis.com/css2?family=Inter:wght@400&amp;display=swap"',
    );
    // Exactly once, in <svelte:head>: the markup chunk is built with
    // `googleFonts: "none"`, so the stylesheet link is never duplicated into it.
    expect(svelte.match(/fonts\.googleapis\.com\/css2/g)).toHaveLength(1);
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
    expect(jsx).toContain('class="ai2html g-all2html"');
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

  it("preserves Google Fonts import and link modes", () => {
    const importDoc = loadAndProcess("single-artboard-basic.json");
    importDoc.settings.googleFonts = "import";
    importDoc.fonts = [
      { sourceFont: "Inter-Regular", family: "Inter,system-ui,sans-serif", weight: "400" },
    ];
    expect(emitReact(importDoc).jsx).toContain(
      '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap");',
    );

    const linkDoc = loadAndProcess("single-artboard-basic.json");
    linkDoc.settings.googleFonts = "link";
    linkDoc.fonts = [
      { sourceFont: "Inter-Regular", family: "Inter,system-ui,sans-serif", weight: "400" },
    ];
    const { jsx } = emitReact(linkDoc);
    expect(jsx).toContain(
      'const googleFontsHref = "https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap";',
    );
    expect(jsx).toContain('<link rel="stylesheet" href={googleFontsHref} />');
    // Once in the head constant, never inlined into the markup chunk.
    expect(jsx.match(/fonts\.googleapis\.com\/css2/g)).toHaveLength(1);
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

  /**
   * The public signature is `(doc, options)` and must stay that way.
   *
   * `emitStandalone` is a root export, so a JavaScript caller passing its
   * options object second gets no type error when a parameter is inserted in
   * front of it — the object is simply read as something else and every option
   * is dropped, including the security-relevant `allowUnsafeHtml: false`, which
   * silently re-enables unsafe binding HTML. Group support is
   * `emitStandaloneGroup`, an explicitly named function, precisely so nothing
   * has to discriminate these two objects by shape.
   */
  it("honors emitter options passed positionally as the second argument", () => {
    const doc = loadAndProcess("tagged-text.json");
    expect(emitStandalone(doc).html).toContain('data-binding-html="true"');
    expect(emitStandalone(doc, { allowUnsafeHtml: false }).html).not.toContain(
      'data-binding-html="true"',
    );
  });

  it("emits every artboard, and emitStandaloneGroup emits the group it is given", () => {
    const doc = loadAndProcess("multi-artboard-responsive.json");
    expect(doc.artboards.length).toBeGreaterThan(1);

    const all = emitStandalone(doc).html;
    for (const ab of doc.artboards) expect(all).toContain(`Artboard: ${ab.name}`);

    const one = emitStandaloneGroup(doc, { artboards: [doc.artboards[0]], slug: "solo" }).html;
    expect(one).toContain(`Artboard: ${doc.artboards[0].name}`);
    expect(one).not.toContain(`Artboard: ${doc.artboards[1].name}`);
  });
});

/**
 * `localPreviewTemplate` substitutes `doc.metadata` and `doc.settings` strings
 * into a file on disk. Those values used to be spliced in verbatim, so a
 * headline carrying markup became live markup in the emitted page — the one
 * metadata path in the product that did not escape.
 */
describe("Standalone emitter: local preview template substitution", () => {
  const payload = `<img src=x onerror=alert(1)>`;

  function renderWithTemplate(template: string, metadata: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "all2html-template-"));
    const templatePath = join(dir, "preview.html");
    writeFileSync(templatePath, template, "utf-8");
    try {
      const doc = loadAndProcess("single-artboard-basic.json");
      doc.settings.localPreviewTemplate = templatePath;
      Object.assign(doc.metadata, metadata);
      return emitStandalone(doc);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("escapes a metadata value into inert text instead of live markup", () => {
    const { html, structuredWarnings } = renderWithTemplate("<h1>{{headline}}</h1>", {
      headline: payload,
    });

    // The template was applied, not silently skipped.
    expect(structuredWarnings.some((w) => w.code === "emit:template-error")).toBe(false);
    // Escaped for every position a slot can occupy, unquoted attribute included,
    // so the inner spaces and `=` are encoded too — see `test/unit/template.test.ts`.
    expect(html).toContain("<h1>&lt;img&#32;src&#61;x&#32;onerror&#61;alert(1)&gt;</h1>");
    expect(html).not.toContain(payload);

    const document = new JSDOM(html).window.document;
    expect(document.querySelector("h1")?.textContent).toBe(payload);
    expect(document.querySelectorAll("img[onerror]")).toHaveLength(0);
  });

  it("escapes a metadata value substituted into an attribute", () => {
    const { html } = renderWithTemplate('<meta name="x" content="{{headline}}">', {
      headline: `" onload="alert(1)`,
    });
    const document = new JSDOM(html).window.document;
    const meta = document.querySelector('meta[name="x"]');
    expect(meta?.getAttribute("content")).toBe(`" onload="alert(1)`);
    expect(meta?.hasAttribute("onload")).toBe(false);
  });

  it("leaves the emitted HTML fragment raw — the partial is markup, not text", () => {
    const { html } = renderWithTemplate("<body>{{ai2htmlPartial}}</body>", {});
    // The fragment reaches the page as markup, and its own escaping is not
    // applied a second time.
    expect(html).toContain("Headline Text Here");
    expect(html).not.toContain("&lt;div");
    const document = new JSDOM(html).window.document;
    expect(document.querySelectorAll("[id^='g-']").length).toBeGreaterThan(0);
  });

  it("renders an ampersand in metadata as itself, not as a double-escaped entity", () => {
    const { html } = renderWithTemplate("<p>{{credit}}</p>", { credit: "Smith & Sons" });
    expect(html).toContain("<p>Smith&#32;&amp;&#32;Sons</p>");
    // The point of the test: `&` yields one entity, not `&amp;amp;`. The `&#32;`
    // around it is the unquoted-attribute-safe escape and decodes to a space.
    expect(new JSDOM(html).window.document.querySelector("p")?.textContent).toBe("Smith & Sons");
  });
});
