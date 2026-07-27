import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { getEmitter } from "../../src/emitters/registry.js";
import {
  type Artboard,
  type Asset,
  CURRENT_IR_VERSION,
  type Document,
} from "../../src/ir/types.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

describe("multiple-files output mode", () => {
  it("groups artboards by name", () => {
    const raw = loadFixture("multiple-files-output.json");
    const { groups } = processDocument(raw);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.name).sort()).toEqual(["chart", "map"]);
  });

  it("each group has its own artboards", () => {
    const raw = loadFixture("multiple-files-output.json");
    const { groups } = processDocument(raw);

    const chart = groups.find((g) => g.name === "chart");
    const map = groups.find((g) => g.name === "map");

    expect(chart?.artboards).toHaveLength(1);
    expect(chart?.artboards[0].width).toBe(600);
    expect(map?.artboards).toHaveLength(1);
    expect(map?.artboards[0].width).toBe(800);
  });

  it("keeps group slugs unique after sanitizing names", () => {
    const raw = loadFixture("multiple-files-output.json");
    raw.artboards[0].name = "Hero!";
    raw.artboards[0].source.name = "Hero!";
    raw.artboards[1].name = "Hero";
    raw.artboards[1].source.name = "Hero";

    const { groups } = processDocument(raw);

    expect(groups.map((group) => group.slug).sort()).toEqual([
      "multi-file-test-hero",
      "multi-file-test-hero-2",
    ]);

    const { document: doc } = processDocument(raw);
    const result = getEmitter("html").emitAll(doc, groups);
    const hero2Html = result.files.find((file) => file.slug === "multi-file-test-hero-2")?.output;

    expect(hero2Html).toContain('id="g-multi-file-test-hero-2-hero"');
    expect(hero2Html).toContain("#g-multi-file-test-hero-2-hero");
  });

  it("emits separate HTML per group", () => {
    const raw = loadFixture("multiple-files-output.json");
    const { document: doc, groups } = processDocument(raw);

    const outputs = groups.map((group) => ({
      name: group.name,
      html: emitHTML(doc, {
        artboards: group.artboards,
        slug: group.slug,
      }).html,
    }));

    expect(outputs).toHaveLength(2);

    const chartHtml = outputs.find((o) => o.name === "chart")?.html;
    const mapHtml = outputs.find((o) => o.name === "map")?.html;

    // Chart HTML contains chart content, not map content
    expect(chartHtml).toContain("Chart Title");
    expect(chartHtml).not.toContain("Map Title");
    expect(chartHtml).toContain("multi-file-test-chart");

    // Map HTML contains map content, not chart content
    expect(mapHtml).toContain("Map Title");
    expect(mapHtml).not.toContain("Chart Title");
    expect(mapHtml).toContain("multi-file-test-map");
  });

  it("keeps grouped CSS selectors aligned with grouped DOM ids", () => {
    const raw = loadFixture("multiple-files-output.json");
    const { document: doc, groups } = processDocument(raw);
    const result = getEmitter("html").emitAll(doc, groups);

    const chartHtml = result.files.find((file) => file.slug === "multi-file-test-chart")?.output;
    const mapHtml = result.files.find((file) => file.slug === "multi-file-test-map")?.output;

    expect(chartHtml).toContain('id="g-multi-file-test-chart-box"');
    expect(chartHtml).toContain("#g-multi-file-test-chart-box");
    expect(mapHtml).toContain('id="g-multi-file-test-map-box"');
    expect(mapHtml).toContain("#g-multi-file-test-map-box");
  });

  /**
   * The standalone descriptor used to name its group parameter `_groups` and
   * emit a single file containing every artboard, while html, svelte and react
   * emitted one per group off the same `groups` array. `output:
   * "multiple-files"` was therefore silently a no-op on exactly one format —
   * and Figma, which offers html and standalone only, was half broken.
   */
  it("emits one standalone file per group, like every other format", () => {
    const raw = loadFixture("multiple-files-output.json");
    const { document: doc, groups } = processDocument(raw);

    const html = getEmitter("html").emitAll(doc, groups);
    const standalone = getEmitter("standalone").emitAll(doc, groups);

    expect(standalone.files).toHaveLength(html.files.length);
    expect(standalone.files.map((file) => file.slug).sort()).toEqual(
      html.files.map((file) => file.slug).sort(),
    );
    expect([...new Set(standalone.files.map((file) => file.extension))]).toEqual([".html"]);
  });

  it("puts each group's content in its own standalone file and nowhere else", () => {
    const raw = loadFixture("multiple-files-output.json");
    const { document: doc, groups } = processDocument(raw);
    const { files } = getEmitter("standalone").emitAll(doc, groups);

    const chart = files.find((file) => file.slug === "multi-file-test-chart")?.output;
    const map = files.find((file) => file.slug === "multi-file-test-map")?.output;

    for (const output of [chart, map]) {
      // Still a whole document, not a fragment — that is what standalone means.
      expect(output).toContain("<!DOCTYPE html>");
      expect(output).toContain("</html>");
    }

    expect(chart).toContain("Chart Title");
    expect(chart).not.toContain("Map Title");
    expect(map).toContain("Map Title");
    expect(map).not.toContain("Chart Title");

    // The DOM ids and the stylesheet follow the group slug, exactly as they do
    // for the html emitter.
    expect(chart).toContain('id="g-multi-file-test-chart-box"');
    expect(chart).toContain("#g-multi-file-test-chart-box");
    expect(chart).not.toContain("g-multi-file-test-map");
    expect(map).toContain('id="g-multi-file-test-map-box"');
    expect(map).not.toContain("g-multi-file-test-chart");
  });

  it("still emits a single standalone file in one-file mode", () => {
    const raw = loadFixture("multiple-files-output.json");
    raw.settings.output = "one-file";
    const { document: doc, groups } = processDocument(raw);
    const { files } = getEmitter("standalone").emitAll(doc, groups);

    expect(files).toHaveLength(1);
    expect(files[0].slug).toBe("multi-file-test");
    expect(files[0].output).toContain("Chart Title");
    expect(files[0].output).toContain("Map Title");
  });

  it("one-file mode puts all artboards in single group", () => {
    const raw = loadFixture("single-artboard-basic.json");
    const { groups } = processDocument(raw);

    expect(groups).toHaveLength(1);
    expect(groups[0].artboards).toHaveLength(1);
  });

  it("responsive artboards with same name stay in one group", () => {
    const raw = loadFixture("multi-artboard-responsive.json");
    const { groups } = processDocument(raw);

    // All artboards have different names, so in one-file mode they're all together
    expect(groups).toHaveLength(1);
    expect(groups[0].artboards).toHaveLength(3);
  });
});

/**
 * Artboards that share a *name* but not an id.
 *
 * These two came from `html-string-emitter.test.ts`, which was otherwise an
 * emitter-vs-itself parity sweep (`emitHTMLString` is a re-export of `emitHTML`
 * since the emitter collapse, SPEC §12.6 / D23) and has been deleted. The
 * assertions below are the part of that file that tested something: background
 * asset selection and group scoping key off the stable artboard id, not the
 * display name, so duplicate names must not collapse into one another.
 */
describe("duplicate artboard names resolve by stable id", () => {
  function artboard(id: string, width: number, height: number, sourceName: string): Artboard {
    return {
      id,
      name: "card",
      width,
      height,
      source: { tool: "test", name: sourceName, width, height },
      layers: [],
    };
  }

  function asset(id: string, artboardId: string, width: number, height: number): Asset {
    return {
      id,
      path: id,
      mimeType: "image/png",
      width,
      height,
      artboardId,
      exportParams: { format: "png", scale: 1, transparent: false },
    };
  }

  function docWith(artboards: Artboard[], assets: Record<string, Asset>, slug: string): Document {
    return {
      irVersion: CURRENT_IR_VERSION,
      source: { tool: "test", toolVersion: "1.0", adapterVersion: "0.1.0" },
      settings: { namespace: "g-" },
      fonts: [],
      artboards,
      customBlocks: [],
      assets,
      metadata: { slug },
    };
  }

  it("gives each same-named artboard its own background image", () => {
    const raw = docWith(
      [
        artboard("artboard:card-640", 640, 360, "card--640"),
        artboard("artboard:card-960", 960, 540, "card--960"),
      ],
      {
        "card-640.png": asset("card-640.png", "artboard:card-640", 640, 360),
        "card-960.png": asset("card-960.png", "artboard:card-960", 960, 540),
      },
      "duplicate-assets",
    );
    const { document: doc } = processDocument(raw);
    const { html } = emitHTML(doc);

    expect(html).toContain('src="all2html-output/card-640.png"');
    expect(html).toContain('src="all2html-output/card-960.png"');
  });

  it("scopes a grouped emit to the requested artboard id", () => {
    // The widths differ only because `computeBreakpoints` now refuses two
    // artboards of the same width on one page — it cannot say which is the
    // narrow variant. What this test is about is the *id*: the two artboards
    // have different names and different assets, and the emit must follow the
    // id it was handed rather than a name or a position.
    const raw = docWith(
      [
        artboard("artboard:first", 640, 360, "card"),
        artboard("artboard:second", 960, 540, "card copy"),
      ],
      {
        "first.png": asset("first.png", "artboard:first", 640, 360),
        "second.png": asset("second.png", "artboard:second", 960, 540),
      },
      "duplicate-scope",
    );
    const { document: doc } = processDocument(raw);
    const second = doc.artboards.find((entry) => entry.id === "artboard:second");
    if (!second) throw new Error("Missing second artboard");

    const { html } = emitHTML(doc, { artboards: [second], slug: "second-card" });
    expect(html).not.toContain("first.png");
    expect(html).toContain('src="all2html-output/second.png"');
  });
});
