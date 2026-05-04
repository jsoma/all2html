import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parsePluginConfig } from "../../plugins/figma/src/config.js";
import { FigmaPluginError } from "../../plugins/figma/src/errors.js";
import { buildExportBundle, createZipArchive } from "../../plugins/figma/src/export.js";
import {
  extractFrameInfo,
  getSelectedTopLevelFrames,
  groupFrameInfos,
  parseFrameName,
} from "../../plugins/figma/src/extract/frames.js";
import { parseLayerType } from "../../plugins/figma/src/extract/layers.js";
import {
  figmaFontToMapping,
  segmentsToParagraph,
  segmentToRun,
} from "../../plugins/figma/src/extract/text.js";
import { buildArtboard, buildDocument } from "../../plugins/figma/src/ir-builder.js";
import { makeFigmaArtboardId } from "../../plugins/figma/src/ir-ids.js";
import type { ExtractedFrame } from "../../plugins/figma/src/types.js";
import {
  applyDirectControlsToConfig,
  createInitialUiState,
  directControlsFromConfig,
  serializePluginConfig,
} from "../../plugins/figma/src/ui.js";
import { CURRENT_IR_VERSION } from "../../src/ir/types.js";

function makeFrame(overrides: Partial<ExtractedFrame> = {}): ExtractedFrame {
  const sourceNodeId = overrides.sourceNodeId ?? "frame-1";
  const originalName = overrides.originalName ?? "story:dynamic";
  return {
    sourceNodeId,
    name: "story",
    originalName,
    width: 640,
    height: 360,
    actualWidth: 640,
    actualHeight: 360,
    responsiveness: "dynamic",
    layers: [
      {
        sourceNodeId: "layer-1",
        name: "content",
        type: "default",
        inlineSvg: false,
        visible: true,
        opacity: 100,
        elements: [
          {
            type: "text",
            id: "headline",
            kind: "point",
            position: { x: 24, y: 24, width: 320, height: 32 },
            opacity: 100,
            valign: "top",
            renderAs: "html",
            paragraphs: [
              {
                text: "Hello from Figma",
                alignment: "left",
                leading: 28,
                spaceBefore: 0,
                spaceAfter: 0,
                runs: [
                  {
                    text: "Hello from Figma",
                    fontName: "Inter-Bold",
                    fontPostScriptName: "Inter-Bold",
                    fontSize: 24,
                    color: { r: 0, g: 0, b: 0 },
                    letterSpacing: 0,
                    capitalization: "normal",
                    baselineShift: "normal",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    assets: [
      {
        id: "story-bg",
        sourceNodeId: "frame-1",
        path: "all2html-output/story-bg.png",
        mimeType: "image/png",
        width: 640,
        height: 360,
        artboardId: makeFigmaArtboardId({ sourceNodeId, originalName }),
        exportParams: { format: "png", scale: 1, transparent: false },
        bytes: new TextEncoder().encode("png-bytes"),
      },
    ],
    ...overrides,
  };
}

describe("Figma plugin foundation", () => {
  describe("frame selection and grouping", () => {
    it("parses all2html-style frame names", () => {
      const result = parseFrameName("mobile:320:dynamic:image");
      expect(result.name).toBe("mobile");
      expect(result.widthOverride).toBe(320);
      expect(result.responsiveness).toBe("dynamic");
      expect(result.imageOnly).toBe(true);
    });

    it("requires selected top-level frames", () => {
      expect(() =>
        getSelectedTopLevelFrames([
          { id: "1", name: "Group 1", type: "GROUP", parent: { type: "PAGE" } },
        ]),
      ).toThrow(FigmaPluginError);
    });

    it("extracts frame info from eligible frame nodes", () => {
      const info = extractFrameInfo({
        id: "f1",
        name: "desktop:1200:fixed",
        type: "FRAME",
        width: 1440,
        height: 900,
        parent: { type: "PAGE" },
      });

      expect(info.sourceNodeId).toBe("f1");
      expect(info.name).toBe("desktop");
      expect(info.width).toBe(1200);
      expect(info.responsiveness).toBe("fixed");
    });

    it("fails responsive groups with duplicate widths", () => {
      expect(() =>
        groupFrameInfos([
          { sourceNodeId: "a", name: "story", originalName: "story:640", width: 640, height: 400 },
          { sourceNodeId: "b", name: "story", originalName: "story", width: 640, height: 500 },
        ]),
      ).toThrow(/duplicate width 640/i);
    });
  });

  describe("layer type detection", () => {
    it("detects supported canonical layer types", () => {
      expect(parseLayerType(":svg Background")).toEqual({
        type: "svg",
        cleanName: "Background",
        inlineSvg: false,
      });
      expect(parseLayerType("Icon :svg:inline")).toEqual({
        type: "svg",
        cleanName: "Icon",
        inlineSvg: true,
      });
      expect(parseLayerType(":html-before Intro").type).toBe("html-before");
      expect(parseLayerType(":video Clip").type).toBe("video");
    });

    it("defaults unknown/deferred prefixes back to default", () => {
      expect(parseLayerType(":snippet Chart").type).toBe("default");
      expect(parseLayerType(":text Headlines").type).toBe("default");
      expect(parseLayerType(":htext Content").type).toBe("default");
    });
  });

  describe("text extraction", () => {
    it("infers CSS font mappings from Figma family and style data", () => {
      expect(
        figmaFontToMapping({
          family: "IBM Plex Sans",
          style: "Semi Bold Italic",
        }),
      ).toEqual({
        sourceFont: "IBM Plex Sans-SemiBoldItalic",
        family: "'IBM Plex Sans',system-ui,sans-serif",
        weight: "600",
        style: "italic",
      });

      expect(
        figmaFontToMapping({
          family: "Poppins",
          style: "ExtraBold",
        }),
      ).toMatchObject({
        sourceFont: "Poppins-ExtraBold",
        family: "Poppins,system-ui,sans-serif",
        weight: "800",
        style: "",
      });
    });

    it("converts Figma segments to canonical runs", () => {
      const run = segmentToRun({
        characters: "Hello",
        start: 0,
        end: 5,
        fontName: { family: "Inter", style: "Bold" },
        fontSize: 16,
        letterSpacing: { value: 1.6, unit: "PIXELS" },
        lineHeight: { value: 24, unit: "PIXELS" },
        fills: [{ type: "SOLID", color: { r: 0.2, g: 0.4, b: 0.6 } }],
        textCase: "UPPER",
        textDecoration: "NONE",
        hyperlink: { type: "URL", value: "https://example.com" },
      });

      expect(run.text).toBe("Hello");
      expect(run.fontName).toBe("Inter-Bold");
      expect(run.letterSpacing).toBeCloseTo(0.1);
      expect(run.capitalization).toBe("allcaps");
      expect(run.hyperlink?.href).toBe("https://example.com");
      expect(run.color).toEqual({ r: 51, g: 102, b: 153 });
    });

    it("builds canonical paragraphs from styled segments", () => {
      const paragraph = segmentsToParagraph([
        {
          characters: "Hello",
          start: 0,
          end: 5,
          fontName: { family: "Inter", style: "Regular" },
          fontSize: 20,
          letterSpacing: { value: 5, unit: "PERCENT" },
          lineHeight: { value: 28, unit: "PIXELS" },
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
          textCase: "ORIGINAL",
          textDecoration: "NONE",
        },
        {
          characters: " world",
          start: 5,
          end: 11,
          fontName: { family: "Inter", style: "Bold" },
          fontSize: 20,
          letterSpacing: { value: 5, unit: "PERCENT" },
          lineHeight: { value: 28, unit: "PIXELS" },
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
          textCase: "ORIGINAL",
          textDecoration: "NONE",
        },
      ]);

      expect(paragraph.text).toBe("Hello world");
      expect(paragraph.leading).toBe(28);
      expect(paragraph.runs).toHaveLength(2);
      expect(paragraph.runs[0].letterSpacing).toBeCloseTo(0.05);
    });
  });

  describe("config parsing", () => {
    it("parses JSONC config for settings, metadata, and fonts", () => {
      const config = parsePluginConfig(`{
        // story-specific overrides
        "settings": { "output": "multiple-files", "projectName": "figma-story", "googleFonts": "link" },
        "metadata": { "headline": "Testing", "lang": "en" },
        "fonts": [{ "sourceFont": "Inter-Bold", "family": "Inter", "weight": "700" }]
      }`);

      expect(config.settings?.output).toBe("multiple-files");
      expect(config.settings?.googleFonts).toBe("link");
      expect(config.metadata?.headline).toBe("Testing");
      expect(config.fonts?.[0].family).toBe("Inter");
    });

    it("throws clear errors for invalid config", () => {
      expect(() => parsePluginConfig('{ "settings": { "output": "bad" } }')).toThrow(
        /Invalid Figma config/i,
      );
    });
  });

  describe("canonical IR builder", () => {
    it("builds canonical artboards from extracted frames", () => {
      const artboard = buildArtboard(makeFrame());
      expect(artboard.name).toBe("story");
      expect(artboard.layers).toHaveLength(1);
      expect(artboard.layers[0].elements[0].type).toBe("text");
    });

    it("builds a validated canonical document", () => {
      const doc = buildDocument([makeFrame()], {
        slug: "figma-story",
        pluginVersion: "0.2.0",
        settings: { output: "multiple-files" },
        metadata: { headline: "Figma Story" },
      });

      expect(doc.irVersion).toBe(CURRENT_IR_VERSION);
      expect(doc.source.tool).toBe("figma");
      expect(doc.metadata.slug).toBe("figma-story");
      expect(doc.metadata.headline).toBe("Figma Story");
      expect(doc.artboards).toHaveLength(1);
      expect(doc.assets["story-bg"].path).toBe("all2html-output/story-bg.png");
    });

    it("auto-adds Figma font mappings and lets config override them", () => {
      const frame = makeFrame();
      const element = frame.layers[0].elements[0];
      if (element.type !== "text") {
        throw new Error("Expected text fixture element.");
      }
      const run = element.paragraphs[0].runs[0];
      run.fontName = "Poppins-ExtraBold";
      run.fontPostScriptName = "Poppins-ExtraBold";

      const automatic = buildDocument([frame], { slug: "figma-story" });
      expect(automatic.fonts).toContainEqual({
        sourceFont: "Poppins-ExtraBold",
        family: "Poppins,system-ui,sans-serif",
        weight: "800",
        style: "",
      });

      const bundle = buildExportBundle(automatic, {
        format: "html",
        assetFiles: frame.assets,
      });
      expect(bundle.warnings).toEqual([]);
      const htmlEntry = bundle.entries.find((entry) => entry.path === "figma-story.html");
      expect(htmlEntry?.content).toContain("font-family: Poppins,system-ui,sans-serif;");

      const configured = buildDocument([frame], {
        slug: "figma-story",
        fonts: [{ sourceFont: "Poppins-ExtraBold", family: "'Hosted Poppins'", weight: "900" }],
      });
      expect(configured.fonts).toContainEqual({
        sourceFont: "Poppins-ExtraBold",
        family: "'Hosted Poppins'",
        weight: "900",
      });
    });
  });

  describe("bundle + zip export", () => {
    it("builds HTML bundles through the core pipeline", () => {
      const ir = buildDocument(
        [
          makeFrame(),
          makeFrame({
            sourceNodeId: "frame-2",
            originalName: "story:1024:dynamic",
            width: 1024,
            actualWidth: 1024,
            assets: [
              {
                id: "story-bg-wide",
                path: "all2html-output/story-bg-wide.png",
                mimeType: "image/png",
                width: 1024,
                height: 360,
                artboardId: makeFigmaArtboardId({
                  sourceNodeId: "frame-2",
                  originalName: "story:1024:dynamic",
                }),
                exportParams: { format: "png", scale: 1, transparent: false },
                bytes: new TextEncoder().encode("wide-png"),
              },
            ],
          }),
        ],
        {
          slug: "figma-story",
          settings: { output: "multiple-files", projectName: "figma-story" },
          fonts: [{ sourceFont: "Inter-Bold", family: "Inter", weight: "700" }],
        },
      );

      const bundle = buildExportBundle(ir, {
        format: "html",
        assetFiles: [
          ...(makeFrame().assets ?? []),
          ...(makeFrame({
            assets: [
              {
                id: "story-bg-wide",
                path: "all2html-output/story-bg-wide.png",
                mimeType: "image/png",
                width: 1024,
                height: 360,
                artboardId: makeFigmaArtboardId({
                  sourceNodeId: "frame-2",
                  originalName: "story:1024:dynamic",
                }),
                exportParams: { format: "png", scale: 1, transparent: false },
                bytes: new TextEncoder().encode("wide-png"),
              },
            ],
          }).assets ?? []),
        ],
      });

      expect(bundle.entries.some((entry) => entry.path === "ir.json")).toBe(true);
      expect(bundle.entries.some((entry) => entry.path === "figma-story-story.html")).toBe(true);

      const htmlEntry = bundle.entries.find((entry) => entry.path === "figma-story-story.html");
      expect(htmlEntry).toBeDefined();
      const html = htmlEntry?.content;
      expect(typeof html).toBe("string");
      expect(html).toContain("Hello from Figma");
      expect(html).toContain("all2html-output/story-bg.png");
      expect(html).toContain("all2html-output/story-bg-wide.png");
      expect(bundle.warnings).toEqual([]);
    });

    it("packages export bundle entries into a zip archive", () => {
      const ir = buildDocument([makeFrame()], { slug: "figma-story" });
      const bundle = buildExportBundle(ir, {
        format: "standalone",
        assetFiles: makeFrame().assets ?? [],
      });

      const archive = createZipArchive(bundle);
      const files = unzipSync(archive);

      expect(strFromU8(files["ir.json"])).toContain('"source"');
      expect(Object.keys(files)).toContain("figma-story.html");
      expect(strFromU8(files["figma-story.html"])).toContain("Hello from Figma");
      expect(strFromU8(files["all2html-output/story-bg.png"])).toBe("png-bytes");
    });
  });

  describe("thin UI state", () => {
    it("creates a supportable config-first UI state", () => {
      const state = createInitialUiState({
        totalSelected: 2,
        eligibleFrames: 2,
        frameNames: ["story:640", "story:1024"],
        groupNames: ["story"],
        groups: [
          {
            name: "story",
            frameCount: 2,
            frameNames: ["story:640", "story:1024"],
            widths: [640, 1024],
            mode: "responsive",
          },
        ],
        exportKind: "responsive",
      });

      expect(state.format).toBe("html");
      expect(state.selection.groupNames).toEqual(["story"]);
      expect(state.advancedOpen).toBe(false);
    });

    it("maps direct controls to canonical config and back", () => {
      const controls = directControlsFromConfig({
        settings: {
          output: "multiple-files",
          projectName: "story",
          responsiveness: "dynamic",
          imageFormat: ["jpg"],
          centerHtmlOutput: false,
          renderTextAs: "image",
          renderRotatedSkewedTextAs: "image",
          googleFonts: "import",
          responsiveImageMode: "css-var",
        },
        metadata: {
          headline: "Story headline",
          altText: "Overall alt",
          imageAltText: "Image alt",
          ariaRole: "img",
        },
      });

      expect(controls.projectName).toBe("story");
      expect(controls.output).toBe("multiple-files");
      expect(controls.imageFormat).toBe("jpg");
      expect(controls.googleFonts).toBe("import");
      expect(controls.responsiveImageMode).toBe("css-var");

      const config = applyDirectControlsToConfig({}, controls);
      expect(config.settings?.projectName).toBe("story");
      expect(config.settings?.imageFormat).toEqual(["jpg"]);
      expect(config.settings?.googleFonts).toBe("import");
      expect(config.metadata?.headline).toBe("Story headline");
      expect(config.metadata?.ariaRole).toBe("img");
      expect(serializePluginConfig(config)).toContain('"projectName": "story"');
    });
  });
});
