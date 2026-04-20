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
  discoverTopLevelSpecialLayerNodes,
  extractSpecialLayer,
  getNodeBoundsRelativeToFrame,
  isValidVideoUrl,
  mapTextAutoResizeToKind,
  resolveSpecialLayerTextValue,
} from "../../plugins/figma/src/runtime-extract.js";

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
