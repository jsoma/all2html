import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { getEmitter } from "../../src/emitters/registry.js";

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

    const chartHtml = outputs.find((o) => o.name === "chart")!.html;
    const mapHtml = outputs.find((o) => o.name === "map")!.html;

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

    const chartHtml = result.files.find((file) => file.slug === "multi-file-test-chart")!.output;
    const mapHtml = result.files.find((file) => file.slug === "multi-file-test-map")!.output;

    expect(chartHtml).toContain('id="g-multi-file-test-chart-box"');
    expect(chartHtml).toContain("#g-multi-file-test-chart-box");
    expect(mapHtml).toContain('id="g-multi-file-test-map-box"');
    expect(mapHtml).toContain("#g-multi-file-test-map-box");
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
