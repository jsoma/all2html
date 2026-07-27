import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { generateCSS } from "../../src/emitters/shared/css.js";

/**
 * Two all2html graphics on one CMS page (D7).
 *
 * The container id and the artboard ids were already namespaced with
 * `{namespace}{slug}-`; element ids were not — the emitter wrote the raw IR id,
 * and the Illustrator exporter mints those per document as `g-ai0-1`, `g-ai0-2`,
 * …. Two graphics on one page therefore emitted the same ids, which is the
 * pym.js failure mode: `document.getElementById` finds the wrong graphic's text,
 * and duplicate ids are invalid HTML besides.
 *
 * The fix is at emit time, not in the exporters: the id an exporter mints is
 * document-local by definition and cannot know what else is on the page.
 */

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function load(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

function elementIds(html: string): string[] {
  const ids: string[] = [];
  for (const match of html.matchAll(/<div id="([^"]+)"/g)) ids.push(match[1]);
  return ids;
}

function allIds(html: string): string[] {
  const ids: string[] = [];
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) ids.push(match[1]);
  return ids;
}

describe("element ids are namespaced per document", () => {
  it("prefixes the raw IR id with the same {ns}{slug}- the container uses", () => {
    const raw = load("single-artboard-basic.json");
    const { document: doc } = processDocument(raw);
    const { html } = emitHTML(doc);

    // The fixture is real exporter output, so its ids are the colliding kind.
    const irIds = doc.artboards
      .flatMap((ab) => ab.layers)
      .flatMap((layer) => layer.elements)
      .filter((el) => el.type === "text")
      .map((el) => el.id);
    expect(irIds.length).toBeGreaterThan(0);
    expect(irIds).toContain("g-ai0-1");

    for (const id of irIds) {
      expect(html).toContain(`id="g-test-graphic-${id}"`);
      // The bare id must be gone: an `id="g-ai0-1"` anywhere is the collision.
      expect(allIds(html)).not.toContain(id);
    }
  });

  it("gives two documents with different slugs disjoint id sets", () => {
    const first = load("single-artboard-basic.json");
    const second = load("single-artboard-basic.json");
    second.metadata = { ...second.metadata, slug: "other-graphic" };

    const firstHtml = emitHTML(processDocument(first).document).html;
    const secondHtml = emitHTML(processDocument(second).document).html;

    const a = allIds(firstHtml);
    const b = allIds(secondHtml);
    expect(a.length).toBeGreaterThan(1);
    expect(a).toEqual([...new Set(a)]);
    expect(b).toEqual([...new Set(b)]);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it("is stable: the same document emits the same ids every time", () => {
    const raw = load("single-artboard-basic.json");
    const once = emitHTML(processDocument(raw).document).html;
    const twice = emitHTML(processDocument(raw).document).html;
    expect(elementIds(once)).toEqual(elementIds(twice));
    expect(once).toEqual(twice);
  });

  it("keeps grouped output disjoint between groups of one document", () => {
    const raw = load("multiple-files-output.json");
    const { document: doc, groups } = processDocument(raw);
    expect(groups.length).toBe(2);

    const [first, second] = groups.map(
      (group) => emitHTML(doc, { artboards: group.artboards, slug: group.slug }).html,
    );
    const a = allIds(first);
    const b = allIds(second);
    expect(a.length).toBeGreaterThan(1);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it("has no stylesheet counterpart, because no generated selector uses an element id", () => {
    const raw = load("single-artboard-basic.json");
    const { document: doc } = processDocument(raw);
    const { css } = generateCSS(doc, { slug: "test-graphic" });

    // Only the container and the artboards are addressed by id; everything else
    // is class-scoped. If that ever stops being true, renaming element ids at
    // emit time silently breaks the stylesheet.
    const selectorIds = [...css.matchAll(/#([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
    expect(selectorIds.length).toBeGreaterThan(0);
    expect([...new Set(selectorIds)].sort()).toEqual([
      "g-test-graphic-box",
      "g-test-graphic-desktop",
    ]);
  });
});

describe("the container carries both the legacy and the namespaced class", () => {
  it("keeps `ai2html` and adds `{ns}all2html`", () => {
    const raw = load("single-artboard-basic.json");
    const { html } = emitHTML(processDocument(raw).document);
    // `ai2html` is parity surface: newsroom CMS templates and resizer scripts
    // select it, so it stays. The namespaced class is additive.
    expect(html).toContain('class="ai2html g-all2html"');
  });

  it("follows the document's namespace setting", () => {
    const raw = load("single-artboard-basic.json");
    raw.settings = { ...raw.settings, namespace: "gfx-" };
    const { html } = emitHTML(processDocument(raw).document);
    expect(html).toContain('class="ai2html gfx-all2html"');
  });
});
