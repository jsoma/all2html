import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocument } from "../../plugins/figma/src/ir-builder.js";
import { exportExtractedFrames } from "../../plugins/figma/src/main.js";
import type { ExtractedFrame } from "../../plugins/figma/src/types.js";
import { processDocument } from "../../src/core/pipeline.js";
import { getEmitter } from "../../src/emitters/registry.js";

const fixtureDir = resolve(import.meta.dirname, "../fixtures/figma");

function loadFrames(name: string): ExtractedFrame[] {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), "utf-8"));
}

function loadFixtureExport(name: string, slug: string) {
  const frames = loadFrames(name);
  return {
    frames,
    html: exportExtractedFrames(frames, { slug, format: "html" }),
    standalone: exportExtractedFrames(frames, { slug, format: "standalone" }),
  };
}

function entryText(
  entries: Array<{ path: string; content: string | Uint8Array }>,
  path: string,
): string {
  const match = entries.find((entry) => entry.path === path);
  if (!match || typeof match.content !== "string") {
    throw new Error(`Missing string entry ${path}`);
  }
  return match.content;
}

function expectTextElementToWrap(html: string, id: string) {
  expect(html).not.toMatch(new RegExp(`id="${id}" class="[^"]*g-aiPointText`));
}

describe("Figma extracted-frame fixtures", () => {
  it("processes the single-frame fixture", () => {
    const doc = buildDocument(loadFrames("single-frame.json"), { slug: "figma-single" });
    const { document, groups } = processDocument(doc);
    const result = getEmitter("html").emitAll(document, groups);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].output).toContain("Single frame fixture");
  });

  it("renders responsive-group fixtures with unique background assets", () => {
    const doc = buildDocument(loadFrames("responsive-group.json"), {
      slug: "figma-responsive",
      settings: { output: "multiple-files", projectName: "figma-responsive" },
    });
    const { document, groups } = processDocument(doc);
    const result = getEmitter("html").emitAll(document, groups);

    expect(groups).toHaveLength(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].output).toContain("all2html-output/story-640.png");
    expect(result.files[0].output).toContain("all2html-output/story-1024.png");
    expect(result.files[0].output).toContain("g-figma-responsive-story-story-640");
    expect(result.files[0].output).toContain("g-figma-responsive-story-story-1024");
    expect(result.files[0].output).not.toContain("--story-640-img");
    expect(result.files[0].output).not.toContain("--story-1024-img");
  });

  it("can opt into css-var responsive image mode with clean url() values", () => {
    const doc = buildDocument(loadFrames("responsive-group.json"), {
      slug: "figma-responsive",
      settings: { output: "multiple-files", projectName: "figma-responsive" },
    });
    const { document, groups } = processDocument(doc);
    const result = getEmitter("html").emitAll(document, groups, {
      html: { responsiveImageMode: "css-var" },
    });

    expect(result.files[0].output).toContain("--story-640-img:url(");
    expect(result.files[0].output).toContain("--story-1024-img:url(");
    expect(result.files[0].output).not.toContain("&#x27;");
  });

  it("preserves hyperlink text from extracted fixtures", () => {
    const doc = buildDocument(loadFrames("hyperlink-text.json"), { slug: "figma-links" });
    const { document, groups } = processDocument(doc);
    const result = getEmitter("html").emitAll(document, groups);

    expect(result.files[0].output).toContain("https://example.com/story");
  });

  it("renders image-only fixtures without phantom text overlays", () => {
    const doc = buildDocument(loadFrames("image-only.json"), { slug: "figma-image-only" });
    const { document, groups } = processDocument(doc);
    const result = getEmitter("html").emitAll(document, groups);

    expect(result.files[0].output).toContain("all2html-output/photo.png");
    expect(result.files[0].output).not.toContain('class="g-content');
    expect(result.files[0].output).not.toContain("<p>");
  });

  it("renders nested-frame extracted payloads without invalid positions", () => {
    const doc = buildDocument(loadFrames("nested-frame.json"), { slug: "figma-nested" });
    const { document, groups } = processDocument(doc);
    const result = getEmitter("html").emitAll(document, groups);

    expect(result.files[0].output).toContain("Nested frame text");
    expect(result.files[0].output).not.toContain("NaN");
  });

  it("exports the newsroom single fixture to html and standalone with preserved links", () => {
    const exported = loadFixtureExport("news-story-single.json", "news-story-single");
    const html = entryText(exported.html.bundle.entries, "news-story-single.html");
    const standalone = entryText(exported.standalone.bundle.entries, "news-story-single.html");

    expect(exported.html.bundle.warnings).toEqual([]);
    expect(html).toContain("Mayor unveils a late-night plan to keep buses moving");
    expect(html).toContain("https://example.com/transit-plan");
    expect(html).toContain("all2html-output/news-story-single-news-story-single.png");
    expectTextElementToWrap(html, "figma-news-single-headline");
    expectTextElementToWrap(html, "figma-news-single-deck");
    expect(standalone).toContain("<!DOCTYPE html>");
    expect(standalone).toContain("https://example.com/transit-plan");
  });

  it("exports the newsroom responsive fixture with sorted widths and html/standalone parity", () => {
    const exported = loadFixtureExport("news-story-responsive.json", "news-story-responsive");
    const html = entryText(exported.html.bundle.entries, "news-story-responsive.html");
    const standalone = entryText(exported.standalone.bundle.entries, "news-story-responsive.html");

    expect(exported.frames.map((frame) => frame.width)).toEqual([640, 960, 1280]);
    expect(exported.html.bundle.warnings).toEqual([]);
    expect(html).toContain("all2html-output/news-story-responsive-news-story-responsive-640.png");
    expect(html).toContain("all2html-output/news-story-responsive-news-story-responsive-960.png");
    expect(html).toContain("all2html-output/news-story-responsive-news-story-responsive-1280.png");
    expect(html).toContain('id="g-news-story-responsive-news-story-responsive-640"');
    expect(html).toContain('id="g-news-story-responsive-news-story-responsive-1280"');
    expect(html).toContain("https://example.com/flood-maps");
    expectTextElementToWrap(html, "figma-news-responsive-headline-640");
    expectTextElementToWrap(html, "figma-news-responsive-headline-960");
    expectTextElementToWrap(html, "figma-news-responsive-headline-1280");
    expect(standalone).toContain("<!DOCTYPE html>");
    expect(standalone).toContain("https://example.com/flood-maps");
  });

  it("exports the newsroom nested fixture without invalid coordinates in either format", () => {
    const exported = loadFixtureExport("news-story-nested.json", "news-story-nested");
    const html = entryText(exported.html.bundle.entries, "news-story-nested.html");
    const standalone = entryText(exported.standalone.bundle.entries, "news-story-nested.html");

    expect(exported.html.bundle.warnings).toEqual([]);
    expect(html).toContain("Parents juggle shifting bus times as districts swap routes");
    expect(html).toContain("https://example.com/service-guide");
    expect(html).toContain("What changed");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
    expectTextElementToWrap(html, "figma-news-nested-headline");
    expectTextElementToWrap(html, "figma-news-nested-body");
    expect(standalone).toContain("<!DOCTYPE html>");
    expect(standalone).not.toContain("NaN");
  });

  it("keeps mixed-warning newsroom output trustworthy around the warned link case", () => {
    const exported = loadFixtureExport("news-story-mixed-warning.json", "news-story-mixed-warning");
    const html = entryText(exported.html.bundle.entries, "news-story-mixed-warning.html");
    const standalone = entryText(
      exported.standalone.bundle.entries,
      "news-story-mixed-warning.html",
    );

    expect(exported.html.bundle.warnings).toEqual([]);
    expect(html).toContain("Library branches extend hours after a spike in afternoon visits");
    expect(html).toContain("Tap to review the branch map");
    expect(html).not.toContain('href="3:46"');
    expect(html).not.toContain("NODE");
    expect(standalone).toContain("<!DOCTYPE html>");
    expect(standalone).toContain("Tap to review the branch map");
  });

  it("exports the special-visual fixture with png, asset svg, and inline svg layers", () => {
    const exported = loadFixtureExport("news-special-visual.json", "news-special-visual");
    const html = entryText(exported.html.bundle.entries, "news-special-visual.html");
    const standalone = entryText(exported.standalone.bundle.entries, "news-special-visual.html");

    expect(exported.html.bundle.warnings).toEqual([]);
    expect(html).toContain(
      "all2html-output/news-special-visual-news-special-visual-storm-track.png",
    );
    expect(html).toContain("all2html-output/news-special-visual-news-special-visual-cone-map.svg");
    expect(html).toContain('data-inline-special="alert-ring"');
    expect(html).toContain("Harbor crews stage floating barriers ahead of the next tide cycle");
    expect(html).not.toContain("Inline alert ring");
    expect(standalone).toContain("<!DOCTYPE html>");
    expect(standalone).toContain(
      "all2html-output/news-special-visual-news-special-visual-cone-map.svg",
    );
  });

  it("exports hook layers around editorial text in the expected order", () => {
    const exported = loadFixtureExport("news-special-hooks.json", "news-special-hooks");
    const html = entryText(exported.html.bundle.entries, "news-special-hooks.html");
    const headlineIndex = html.indexOf(
      "Transit planners add weekend trains for the next construction phase",
    );
    const beforeIndex = html.indexOf('data-hook="before"');
    const afterIndex = html.indexOf('data-hook="after"');

    expect(exported.html.bundle.warnings).toEqual([]);
    expect(beforeIndex).toBeGreaterThan(-1);
    expect(afterIndex).toBeGreaterThan(-1);
    expect(beforeIndex).toBeLessThan(headlineIndex);
    expect(afterIndex).toBeGreaterThan(headlineIndex);
  });

  it("exports the special-video fixture with one valid video element", () => {
    const exported = loadFixtureExport("news-special-video.json", "news-special-video");
    const html = entryText(exported.html.bundle.entries, "news-special-video.html");
    const standalone = entryText(exported.standalone.bundle.entries, "news-special-video.html");

    expect(exported.html.bundle.warnings).toEqual([]);
    expect(html).toContain("<video");
    expect(html).toContain("https://cdn.example.com/night-service.mp4");
    expect(html).toContain(
      "Night crews test a new bus lane while cameras stream the first rush-hour run",
    );
    expect(standalone).toContain("<!DOCTYPE html>");
    expect(standalone).toContain("<video");
  });

  it("exports the mixed special-layer fixture as a responsive group without duplicated overlay markup", () => {
    const exported = loadFixtureExport("news-special-mixed.json", "news-special-mixed");
    const html = entryText(exported.html.bundle.entries, "news-special-mixed.html");
    const standalone = entryText(exported.standalone.bundle.entries, "news-special-mixed.html");

    expect(exported.frames.map((frame) => frame.width)).toEqual([640, 960]);
    expect(exported.html.bundle.warnings).toEqual([]);
    expect(html).toContain(
      "all2html-output/news-special-mixed-news-special-mixed-640-route-highlight.png",
    );
    expect(html).toContain(
      "all2html-output/news-special-mixed-news-special-mixed-960-route-highlight.png",
    );
    expect(html).toContain('data-hook="briefing"');
    expect(html).toContain('id="g-news-special-mixed-news-special-mixed-640"');
    expect(html).not.toContain("NaN");
    expect(standalone).toContain("<!DOCTYPE html>");
  });
});
