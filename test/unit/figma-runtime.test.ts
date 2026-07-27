import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { FigmaTextSegment } from "../../plugins/figma/src/extract/text.js";
import { isUiToSandboxMessage } from "../../plugins/figma/src/messages.js";
import {
  loadLocalUiState,
  loadSharedConfig,
  saveLocalUiState,
  saveSharedConfig,
} from "../../plugins/figma/src/persistence.js";
import {
  collectSegmentWarnings,
  createBackgroundAsset,
  discoverTopLevelSpecialLayerNodes,
  extractSpecialLayer,
  FIGMA_EXPORT_PARAMS,
  getNodeBoundsRelativeToFrame,
  isValidVideoUrl,
  mapTextAutoResizeToKind,
  resolveSpecialLayerTextValue,
} from "../../plugins/figma/src/runtime-extract.js";
import { figmaCapabilities } from "../../src/core/capabilities.js";

const fixtureDir = resolve(import.meta.dirname, "../fixtures/figma");

describe("Figma runtime helpers", () => {
  it("validates UI-to-sandbox message payloads", () => {
    expect(isUiToSandboxMessage({ type: "get-selection-summary" })).toBe(true);
    expect(isUiToSandboxMessage({ type: "load-config" })).toBe(true);
    expect(
      isUiToSandboxMessage({
        type: "save-local-ui-state",
        localState: {
          format: "html",
          advancedOpen: true,
          moreSettingsOpen: false,
          preset: "standard-story",
        },
      }),
    ).toBe(true);
    expect(isUiToSandboxMessage({ type: "save-config", configText: "{}" })).toBe(true);
    expect(isUiToSandboxMessage({ type: "export", configText: "{}", format: "standalone" })).toBe(
      true,
    );
    expect(isUiToSandboxMessage({ type: "export", configText: "{}", format: "react" })).toBe(false);
  });

  it("loads and saves shared config via plugin data", () => {
    let stored = "";
    const store = {
      getPluginData: () => stored,
      setPluginData: (_key: string, value: string) => {
        stored = value;
      },
    };

    expect(loadSharedConfig(store)).toBe("");
    expect(saveSharedConfig(store, ' { "settings": { "output": "multiple-files" } } ')).toBe(
      '{ "settings": { "output": "multiple-files" } }',
    );
    expect(loadSharedConfig(store)).toBe('{ "settings": { "output": "multiple-files" } }');
  });

  it("loads and saves local UI state via clientStorage", async () => {
    let stored: unknown;
    const storage = {
      async getAsync() {
        return stored;
      },
      async setAsync(_key: string, value: unknown) {
        stored = value;
      },
    };

    expect(await loadLocalUiState(storage)).toEqual({
      format: "html",
      advancedOpen: false,
      moreSettingsOpen: false,
      preset: "standard-story",
    });
    await saveLocalUiState(storage, {
      format: "standalone",
      advancedOpen: true,
      moreSettingsOpen: true,
      preset: "responsive-story",
    });
    expect(await loadLocalUiState(storage)).toEqual({
      format: "standalone",
      advancedOpen: true,
      moreSettingsOpen: true,
      preset: "responsive-story",
    });
  });

  it("computes text bounds relative to the selected frame", () => {
    const frame = {
      absoluteTransform: [
        [1, 0, 120],
        [0, 1, 80],
      ],
    };
    const node = {
      absoluteTransform: [
        [1, 0, 172],
        [0, 1, 146],
      ],
      width: 240,
      height: 40,
    };

    expect(getNodeBoundsRelativeToFrame(node as never, frame as never)).toEqual({
      x: 52,
      y: 66,
      width: 240,
      height: 40,
    });
  });

  it("maps fixed-width figma text boxes to area text", () => {
    expect(mapTextAutoResizeToKind("WIDTH_AND_HEIGHT")).toBe("point");
    expect(mapTextAutoResizeToKind("HEIGHT")).toBe("area");
    expect(mapTextAutoResizeToKind("NONE")).toBe("area");
    expect(mapTextAutoResizeToKind("TRUNCATE")).toBe("area");
  });

  it("warns clearly for unsupported Figma node hyperlinks", () => {
    const segments = JSON.parse(
      readFileSync(resolve(fixtureDir, "news-story-mixed-warning-segments.json"), "utf-8"),
    ) as FigmaTextSegment[];

    expect(collectSegmentWarnings(segments, { name: "mixed-link", id: "3:49" })).toEqual([
      `Text node "mixed-link" uses a Figma node link, which all2html doesn't export yet. The text was exported without the link.`,
    ]);
  });

  it("detects only top-level tagged special layers", () => {
    const nestedTagged = {
      id: "nested-tag",
      name: "nested-callout:html-before",
      visible: true,
      children: [],
    };
    const frame = {
      children: [
        {
          id: "top-png",
          name: "highlight:png",
          visible: true,
          children: [],
        },
        {
          id: "top-default",
          name: "content",
          visible: true,
          children: [nestedTagged],
        },
      ],
    };

    expect(
      discoverTopLevelSpecialLayerNodes(frame as never).map((entry) => ({
        id: entry.node.id,
        name: entry.name,
        type: entry.type,
        inlineSvg: entry.inlineSvg,
      })),
    ).toEqual([
      {
        id: "top-png",
        name: "highlight",
        type: "png",
        inlineSvg: false,
      },
    ]);
  });

  /**
   * `exportParams` is a record of what the bytes beside it actually are, and
   * `figmaCapabilities` is a claim about the same thing. When they disagree,
   * one of them is lying to the user — this is the D1 defect from
   * `internal-docs/capability-matrix.md` (`exportParams.format` recording `svg`
   * over PNG8 bytes) reproduced on Figma. Figma's `exportAsync({format:"PNG"})`
   * takes no bit-depth, palette, or matte option and no `constraint`, so it
   * produces full-color PNG with alpha at 1x: png24, transparent, scale 1.
   */
  describe("PNG export records agree with the Figma capability declaration", () => {
    const params = FIGMA_EXPORT_PARAMS.png;

    it("records the format the declaration says Figma produces", () => {
      const imageFormat = figmaCapabilities.settings.imageFormat;
      expect(imageFormat?.status).toBe("partial");
      expect(imageFormat?.values).toContain(params.format);
      expect(params.format).toBe("png24");
    });

    it("records the alpha and scale the declaration says Figma diverges to", () => {
      // `divergesAtDefault` is the value the surface really behaves as (D25).
      expect(figmaCapabilities.settings.pngTransparent?.divergesAtDefault).toBe(params.transparent);
      expect(params.transparent).toBe(true);

      // use2xImages false <=> scale 1. Any 2x export would set a SCALE constraint.
      expect(figmaCapabilities.settings.use2xImages?.divergesAtDefault).toBe(false);
      expect(params.scale).toBe(1);
    });

    it("stamps those params on both the background and overlay PNG assets", async () => {
      const frameInfo = {
        name: "story",
        originalName: "story:640:dynamic",
        sourceNodeId: "frame-1",
        width: 640,
        height: 360,
      } as never;

      const background = createBackgroundAsset(
        "figma-story",
        frameInfo,
        640,
        360,
        new Uint8Array([1]),
      );
      expect(background.exportParams).toEqual(params);
      expect(background.mimeType).toBe("image/png");

      const overlay = await extractSpecialLayer(
        {
          name: "highlight",
          type: "png",
          inlineSvg: false,
          node: {
            id: "png-1",
            name: "highlight:png",
            type: "FRAME",
            visible: true,
            width: 200,
            height: 100,
            exportAsync: async () => new Uint8Array([2]),
          } as never,
        },
        frameInfo,
        "figma-story",
        [],
      );
      expect(overlay.assets[0]?.exportParams).toEqual(params);
      // The extension is not the format: a .png file holding png24 bytes.
      expect(overlay.assets[0]?.path.endsWith(".png")).toBe(true);

      const svgLayer = await extractSpecialLayer(
        {
          name: "map",
          type: "svg",
          inlineSvg: false,
          node: {
            id: "svg-1",
            name: "map:svg",
            type: "FRAME",
            visible: true,
            width: 200,
            height: 100,
            exportAsync: async () => new Uint8Array([3]),
          } as never,
        },
        frameInfo,
        "figma-story",
        [],
      );
      expect(svgLayer.assets[0]?.exportParams).toEqual(FIGMA_EXPORT_PARAMS.svg);
    });
  });

  it("accepts only https mp4 video URLs for :video layers", () => {
    expect(isValidVideoUrl("https://cdn.example.com/video.mp4")).toBe(true);
    expect(isValidVideoUrl("https://cdn.example.com/video.mp4?autoplay=1")).toBe(true);
    expect(isValidVideoUrl("http://cdn.example.com/video.mp4")).toBe(false);
    expect(isValidVideoUrl("https://cdn.example.com/video.mov")).toBe(false);
    expect(isValidVideoUrl("not-a-url")).toBe(false);
  });

  it("warns clearly for hidden, empty, and ambiguous special-layer text content", () => {
    expect(
      resolveSpecialLayerTextValue(
        { name: "deck-hook", type: "html-before", inlineSvg: false, visible: false },
        [],
        "HTML content",
      ),
    ).toEqual({
      value: null,
      warning: 'Layer "deck-hook" tagged :html-before is hidden and was skipped.',
    });

    expect(
      resolveSpecialLayerTextValue(
        { name: "hero-video", type: "video", inlineSvg: false, visible: true },
        ["   "],
        "an https://...mp4 URL",
      ),
    ).toEqual({
      value: null,
      warning: 'Layer "hero-video" tagged :video needs an https://...mp4 URL. It was skipped.',
    });

    expect(
      resolveSpecialLayerTextValue(
        { name: "source-hook", type: "html-after", inlineSvg: false, visible: true },
        ["<div>One</div>", "<div>Two</div>"],
        "HTML content",
      ),
    ).toEqual({
      value: null,
      warning:
        'Layer "source-hook" tagged :html-after needs one visible text node with HTML content. It was skipped.',
    });
  });

  it("warns through runtime extraction for invalid special-layer video and hook content", async () => {
    const warnings: string[] = [];
    const frameInfo = { name: "news-special", width: 640, height: 360 } as never;

    const invalidVideo = await extractSpecialLayer(
      {
        name: "hero-video",
        type: "video",
        inlineSvg: false,
        node: {
          id: "video-1",
          name: "hero-video:video",
          type: "FRAME",
          visible: true,
          children: [
            {
              id: "text-1",
              type: "TEXT",
              visible: true,
              characters: "https://cdn.example.com/video.mov",
            },
          ],
        } as never,
      },
      frameInfo,
      "news-special",
      warnings,
    );

    expect(invalidVideo).toEqual({ layer: null, assets: [] });
    expect(warnings).toContain(
      'Layer "hero-video" tagged :video needs an https://...mp4 URL. The layer was skipped.',
    );

    const ambiguousHook = await extractSpecialLayer(
      {
        name: "source-hook",
        type: "html-after",
        inlineSvg: false,
        node: {
          id: "hook-1",
          name: "source-hook:html-after",
          type: "FRAME",
          visible: true,
          children: [
            { id: "text-2", type: "TEXT", visible: true, characters: "<div>One</div>" },
            { id: "text-3", type: "TEXT", visible: true, characters: "<div>Two</div>" },
          ],
        } as never,
      },
      frameInfo,
      "news-special",
      warnings,
    );

    expect(ambiguousHook).toEqual({ layer: null, assets: [] });
    expect(warnings).toContain(
      'Layer "source-hook" tagged :html-after needs one visible text node with HTML content. It was skipped.',
    );
  });
});
