import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { getEmitter } from "../../src/emitters/registry.js";
import { loadAndValidateIR } from "../../src/ir/validate.js";
import {
  getIllustratorFixtureGoldenIrPath,
  getIllustratorFixtureOutputDir,
  getIllustratorFixtureSummaryPath,
  type IllustratorFixture,
  illustratorFixtures,
} from "../fixtures/illustrator-fixtures.js";

const rootDir = resolve(import.meta.dirname, "../..");

function loadGoldenFixture(fixture: IllustratorFixture) {
  const path = getIllustratorFixtureGoldenIrPath(rootDir, fixture);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadFixtureSummary(fixture: IllustratorFixture) {
  const path = getIllustratorFixtureSummaryPath(rootDir, fixture);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

interface FixtureLayer {
  name: string;
  type: string;
  elements: unknown[];
}

interface FixtureArtboard {
  name: string;
  layers: FixtureLayer[];
}

interface FixtureSummary {
  warnings?: Record<string, string[]>;
}

const fixtureAssertions: Record<
  string,
  (raw: Record<string, unknown>, html: string, summary: FixtureSummary | null) => void
> = {
  accessibility: (raw, html) => {
    const metadata = raw.metadata as Record<string, unknown>;
    const settings = raw.settings as Record<string, unknown>;

    expect(metadata.altText).toBe("Accessibility fixture alt text");
    expect(metadata.ariaRole).toBe("img");
    expect(settings.clickableLink).toBe("https://example.com/accessibility");
    expect(html).toContain('role="img"');
    expect(html).toContain("Accessibility fixture alt text");
    expect(html).toContain('href="https://example.com/accessibility"');
  },
  hyperlinks: (raw, html) => {
    const settings = raw.settings as Record<string, unknown>;
    expect(settings.clickableLink).toBe("https://example.com/story");
    expect(html).toContain('href="https://example.com/story"');
    expect(html).toContain("Hyperlink fixture");
    expect(html).toContain("This document proves the supported Illustrator contract");
    expect(html).not.toContain("data-binding-html");
  },
  "layer-export-matrix": (raw, html) => {
    const assets = raw.assets as Record<string, { path?: string; mimeType?: string }>;
    const assetPaths = Object.values(assets).map((asset) => asset.path);

    expect(assetPaths).toContain("layer-export-matrix-desktop-external.svg");
    expect(assetPaths).toContain("layer-export-matrix-desktop-overlay.png");
    expect(html).toContain("<svg");
    expect(html).toContain("layer-export-matrix-desktop-external.svg");
    expect(html).toContain("layer-export-matrix-desktop-overlay.png");
    expect(html).toContain("Layer export matrix");
  },
  "mask-test": (_raw, html) => {
    const paragraphs = html.match(/<p[^>]*>.*?<\/p>/g) || [];
    expect(paragraphs).toHaveLength(2);
    expect(html).toContain("Lorem Ipsum");
    expect(html).not.toContain("Masked content should stay hidden");
  },
  "layer-types-test": (_raw, html) => {
    expect(html).toContain("<video");
    expect(html).toContain("highlight.png");
    expect(html).toContain("g-aiSymbol");
    expect(html).toContain('<div class="promo">Breaking News</div>');
    expect(html).toContain("<footer>Source: Test Data</footer>");
  },
  "multiple-files-test": (raw) => {
    const { document: doc, groups } = processDocument(raw);
    const result = getEmitter("html").emitAll(doc, groups);

    expect(groups).toHaveLength(2);
    expect(result.files).toHaveLength(2);

    const artboard1Html = result.files.find(
      (file) => file.slug === "multiple-files-test-artboard-1",
    )?.output;
    const artboard2Html = result.files.find(
      (file) => file.slug === "multiple-files-test-artboard-2",
    )?.output;

    expect(artboard1Html).toContain("Artboard_1");
    expect(artboard1Html).toContain('id="g-multiple-files-test-artboard-1-box"');
    expect(artboard2Html).toContain("Artboard_2");
    expect(artboard2Html).toContain('id="g-multiple-files-test-artboard-2-box"');
  },
  "settings-precedence": (raw, html) => {
    const settings = raw.settings as Record<string, unknown>;
    expect(settings.output).toBe("one-file");
    expect(settings.imageFormat).toEqual(["png"]);
    expect(settings.maxWidth).toBe(640);
    expect(settings.jpgQuality).toBe(85);
    expect(html).toContain("Settings precedence fixture");
  },
  "video-editorial": (raw, html, summary) => {
    const layers = (raw.artboards as FixtureArtboard[])[0].layers;
    const validLayer = layers.find((layer) => layer.name === "hero-video");
    const invalidLayers = layers.filter(
      (layer) => layer.type === "video" && layer.name !== "hero-video",
    );

    expect(summary).not.toBeNull();
    expect(validLayer?.elements).toHaveLength(1);
    expect(invalidLayers.every((layer) => layer.elements.length === 0)).toBe(true);
    expect((html.match(/<video/g) || []).length).toBe(1);
    expect(html).toContain("https://example.com/video.mp4");

    const warningGroups = (summary?.warnings as Record<string, string[]>) || {};
    const allWarnings = Object.values(warningGroups).flat();
    expect(allWarnings.some((warning) => warning.includes('Layer "bad-ext" tagged :video'))).toBe(
      true,
    );
    expect(
      allWarnings.some((warning) => warning.includes('Layer "bad-protocol" tagged :video')),
    ).toBe(true);
    expect(
      allWarnings.some((warning) => warning.includes('Layer "blank-video" tagged :video')),
    ).toBe(true);
  },
  "html-hooks-editorial": (_raw, html, summary) => {
    expect(summary).not.toBeNull();
    expect(html).toContain('data-hook="block-before"');
    expect(html).toContain('data-hook="layer-before"');
    expect(html).toContain('data-hook="layer-after"');
    expect(html).toContain('data-hook="block-after"');
    expect(html.indexOf('data-hook="block-before"')).toBeLessThan(
      html.indexOf("HTML hooks editorial fixture"),
    );
    expect(html.indexOf('data-hook="layer-before"')).toBeLessThan(
      html.indexOf("HTML hooks editorial fixture"),
    );
    expect(html.indexOf('data-hook="layer-after"')).toBeGreaterThan(
      html.indexOf("HTML hooks editorial fixture"),
    );
    expect(html.indexOf('data-hook="block-after"')).toBeGreaterThan(
      html.indexOf("HTML hooks editorial fixture"),
    );
    expect(html).not.toContain("empty layer hook should not render");
    expect(html).not.toContain("hidden block hook should not render");

    const warningGroups = (summary?.warnings as Record<string, string[]>) || {};
    const allWarnings = Object.values(warningGroups).flat();
    expect(
      allWarnings.some((warning) => warning.includes("Skipping hidden ai2html-html-before block.")),
    ).toBe(true);
    expect(
      allWarnings.some((warning) =>
        warning.includes('Layer "blank-layer-hook" tagged :html-before'),
      ),
    ).toBe(true);
  },
  "large-story": (raw, html) => {
    const { document: processed } = processDocument(raw);
    const artboards = processed.artboards;
    const assets = raw.assets as Record<string, unknown>;
    expect(artboards.length).toBe(6);
    expect(Object.keys(assets).length).toBe(18);
    expect(html).toContain("Story card 1");
    expect(html).toContain("Story card 6");
    expect(html).toContain("large-story-story-1-locator.svg");
    expect(html).toContain("large-story-story-6-highlight.png");
    for (const artboard of artboards) {
      expect(
        artboard.breakpoint.maxWidth === undefined ||
          artboard.breakpoint.maxWidth >= artboard.breakpoint.minWidth,
      ).toBe(true);
    }
  },
};

/**
 * Fixtures deliberately covered only by the generic golden-IR check.
 *
 * This list exists so that "no bespoke assertion" is a stated decision rather
 * than an accident. Previously each fixture got three `it`s that early-`return`ed
 * when they had nothing to do, so 29 of 60 tests reported green while asserting
 * nothing — and a fixture that lost its assertions would go quiet without
 * failing anything.
 */
const FIXTURES_WITHOUT_BESPOKE_ASSERTIONS = new Set([
  "countries",
  "fixed",
  "template",
  "sample-ai-file",
  "text-cleanup",
  "rotated-text-real",
  "rotated-text-image",
  "character-styles-real",
  "font-mapping-real",
  "overset-text-real",
]);

describe("Illustrator hardening fixtures", () => {
  it("keeps the assertion map and the registry in step", () => {
    const registered = new Set(illustratorFixtures.map((fixture) => fixture.name));

    for (const name of Object.keys(fixtureAssertions)) {
      expect(registered, `${name} has assertions but is not registered`).toContain(name);
    }
    for (const name of FIXTURES_WITHOUT_BESPOKE_ASSERTIONS) {
      expect(registered, `${name} is exempted but is not registered`).toContain(name);
      expect(fixtureAssertions, name).not.toHaveProperty(name);
    }
    // Every registered fixture is either asserted or explicitly exempted.
    for (const fixture of illustratorFixtures) {
      expect(
        fixtureAssertions[fixture.name] !== undefined ||
          FIXTURES_WITHOUT_BESPOKE_ASSERTIONS.has(fixture.name),
        `${fixture.name} has no assertions and is not on the exemption list`,
      ).toBe(true);
      // Every release-blocking fixture must carry real assertions.
      if (fixture.releaseBlocking) {
        expect(fixtureAssertions, `${fixture.name} is release-blocking`).toHaveProperty(
          fixture.name,
        );
      }
      // The generic check below assumes a golden exists for every fixture.
      expect(fixture.requiredArtifacts.goldenIr, fixture.name).toBe(true);
    }
  });

  // One test per fixture. Every branch below is reached by at least one fixture
  // and is guarded by the registry check above, so nothing here can silently
  // become a no-op.
  for (const fixture of illustratorFixtures) {
    it(`${fixture.name} exports, validates and satisfies its assertions`, () => {
      if (fixture.releaseBlocking) {
        expect(existsSync(resolve(rootDir, fixture.sourceAiPath)), fixture.sourceAiPath).toBe(true);

        const outputDir = getIllustratorFixtureOutputDir(rootDir, fixture);
        expect(existsSync(outputDir), outputDir).toBe(true);
        expect(existsSync(resolve(outputDir, "ir.json")), `${outputDir}/ir.json`).toBe(true);
      }

      const raw = loadGoldenFixture(fixture);
      const validated = loadAndValidateIR(raw);
      expect(validated.artboards.length).toBeGreaterThan(0);

      const { document: processed } = processDocument(raw);
      const { html } = emitHTML(processed);
      expect(html).toContain("<!-- Generated by all2html -->");
      expect(html).toContain('class="ai2html g-all2html"');

      fixtureAssertions[fixture.name]?.(raw, html, loadFixtureSummary(fixture));
    });
  }
});
