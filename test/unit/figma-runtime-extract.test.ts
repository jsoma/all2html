import { afterEach, describe, expect, it } from "vitest";
import { buildDocument } from "../../plugins/figma/src/ir-builder.js";
import {
  extractFramesFromSelection,
  rendersTextIntoBackground,
} from "../../plugins/figma/src/runtime-extract.js";
import { processDocument } from "../../src/core/pipeline.js";

/**
 * A minimal in-memory stand-in for the Figma scene graph, just enough for
 * `extractFramesFromSelection` to run: cloning, normalization, text walking,
 * and `exportAsync`. The export fake snapshots each text node's visibility at
 * the moment the background raster is taken — that is the observable half of
 * the image-only disposition (`rendersTextIntoBackground`): text recorded with
 * `renderAs: "image"` must still be visible when the raster is exported, and
 * text recorded as `renderAs: "html"` must already be hidden.
 */

interface FakeTextNode {
  id: string;
  name: string;
  type: "TEXT";
  visible: boolean;
  opacity: number;
  rotation: number;
  width: number;
  height: number;
  absoluteTransform: number[][];
  textAlignHorizontal: string;
  textAlignVertical: string;
  textAutoResize: string;
  characters: string;
  getStyledTextSegments(fields: readonly string[]): unknown[];
}

function makeFakeTextNode(id: string, characters: string, y = 40): FakeTextNode {
  return {
    id,
    name: "caption",
    type: "TEXT",
    visible: true,
    opacity: 1,
    rotation: 0,
    width: 320,
    height: 28,
    absoluteTransform: [
      [1, 0, 24],
      [0, 1, y],
    ],
    textAlignHorizontal: "LEFT",
    textAlignVertical: "TOP",
    textAutoResize: "WIDTH_AND_HEIGHT",
    characters,
    getStyledTextSegments: () => [
      {
        characters,
        start: 0,
        end: characters.length,
        fontName: { family: "Inter", style: "Regular" },
        fontSize: 20,
        letterSpacing: { value: 0, unit: "PIXELS" },
        lineHeight: { value: 26, unit: "PIXELS" },
        fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
        textCase: "ORIGINAL",
        textDecoration: "NONE",
      },
    ],
  };
}

interface FakeFrameNode {
  id: string;
  name: string;
  type: "FRAME";
  visible: boolean;
  width: number;
  height: number;
  layoutMode: string;
  absoluteTransform: number[][];
  children: FakeTextNode[];
  parent: { type: string };
  /** Text visibility captured inside `exportAsync`, i.e. at raster time. */
  exportTimeTextVisibility: Array<{ id: string; visible: boolean }> | null;
  clone(): FakeFrameNode;
  remove(): void;
  exportAsync(settings: unknown): Promise<Uint8Array>;
}

function makeFakeFrame(options: {
  id: string;
  name: string;
  width: number;
  height?: number;
  children: FakeTextNode[];
}): FakeFrameNode {
  const node: FakeFrameNode = {
    id: options.id,
    name: options.name,
    type: "FRAME",
    visible: true,
    width: options.width,
    height: options.height ?? 360,
    layoutMode: "NONE",
    absoluteTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    children: options.children,
    parent: { type: "PAGE" },
    exportTimeTextVisibility: null,
    // The real code clones and mutates the clone; mutating the original is
    // equivalent for these assertions and keeps the fake small.
    clone: () => node,
    remove: () => {},
    exportAsync: async () => {
      node.exportTimeTextVisibility = options.children.map((child) => ({
        id: child.id,
        visible: child.visible,
      }));
      return new Uint8Array([137, 80, 78, 71]);
    },
  };
  return node;
}

function installFakeFigma() {
  const tempRoot = {
    name: "",
    layoutMode: "",
    clipsContent: true,
    x: 0,
    y: 0,
    removed: false,
    children: [] as unknown[],
    appendChild(child: unknown) {
      this.children.push(child);
    },
    remove() {
      this.removed = true;
    },
  };
  (globalThis as { figma?: unknown }).figma = {
    createFrame: () => tempRoot,
    currentPage: { appendChild: () => {} },
  };
  return tempRoot;
}

async function extract(frames: FakeFrameNode[], slug: string) {
  return extractFramesFromSelection(frames as never, { slug });
}

describe("Figma runtime frame extraction", () => {
  afterEach(() => {
    delete (globalThis as { figma?: unknown }).figma;
  });

  it("shares one image-only predicate", () => {
    expect(rendersTextIntoBackground({ imageOnly: true })).toBe(true);
    expect(rendersTextIntoBackground({ imageOnly: false })).toBe(false);
    expect(rendersTextIntoBackground({})).toBe(false);
  });

  it("records image-only text in the IR and keeps it visible for the background raster", async () => {
    const tempRoot = installFakeFigma();
    const frame = makeFakeFrame({
      id: "1:1",
      name: "photo:image-only",
      width: 800,
      height: 450,
      children: [makeFakeTextNode("10:1", "Baked caption")],
    });

    const { frames, warnings } = await extract([frame], "figma-photo");

    expect(warnings).toEqual([]);
    // Text was visible in the clone when the raster was exported.
    expect(frame.exportTimeTextVisibility).toEqual([{ id: "10:1", visible: true }]);

    // ...and it is recorded in the extracted layer as rasterized text.
    const element = frames[0].layers[0].elements[0];
    if (element.type !== "text") throw new Error("Expected a text element.");
    expect(element.renderAs).toBe("image");
    expect(element.renderAsReason).toBe("imageOnly");
    expect(element.paragraphs[0].text).toBe("Baked caption");

    // The IR keeps both facts: the text record and the background asset.
    const doc = buildDocument(frames, { slug: "figma-photo" });
    const irElement = doc.artboards[0].layers[0].elements[0];
    if (irElement.type !== "text") throw new Error("Expected an IR text element.");
    expect(irElement.renderAs).toBe("image");
    expect(irElement.renderAsReason).toBe("imageOnly");
    expect(doc.assets[`${doc.artboards[0].id}:background`]).toBeDefined();

    // The pipeline accepts the extracted document as-is (image-rendered text
    // is skipped by the transforms, not cast around).
    expect(() =>
      processDocument(doc, { surface: { surface: "figma", path: "render", format: "html" } }),
    ).not.toThrow();
    expect(tempRoot.removed).toBe(true);
  });

  it("hides text in the clone and emits live HTML text for normal frames", async () => {
    installFakeFigma();
    const frame = makeFakeFrame({
      id: "1:1",
      name: "story",
      width: 640,
      children: [makeFakeTextNode("10:1", "Live headline")],
    });

    const { frames, warnings } = await extract([frame], "figma-story");

    expect(warnings).toEqual([]);
    // Text was hidden before the raster export...
    expect(frame.exportTimeTextVisibility).toEqual([{ id: "10:1", visible: false }]);

    // ...because it is recorded as live HTML text.
    const element = frames[0].layers[0].elements[0];
    if (element.type !== "text") throw new Error("Expected a text element.");
    expect(element.renderAs).toBe("html");
    expect(element.renderAsReason).toBeUndefined();

    const doc = buildDocument(frames, { slug: "figma-story" });
    const irElement = doc.artboards[0].layers[0].elements[0];
    if (irElement.type !== "text") throw new Error("Expected an IR text element.");
    expect(irElement.renderAs).toBe("html");
  });

  it("derives distinct background asset ids and paths for same-named frames", async () => {
    installFakeFigma();
    // Same display name is legal — differing widths form a responsive group —
    // so asset identity must come from the owner ids, not the names.
    const narrow = makeFakeFrame({ id: "1:1", name: "story", width: 640, children: [] });
    const wide = makeFakeFrame({ id: "2:2", name: "story", width: 960, children: [] });

    const { frames, warnings } = await extract([narrow, wide], "figma-story");

    expect(warnings).toEqual([]);
    const [narrowAsset] = frames[0].assets ?? [];
    const [wideAsset] = frames[1].assets ?? [];
    expect(narrowAsset.id).toBe("figma:1-1:background");
    expect(wideAsset.id).toBe("figma:2-2:background");
    expect(narrowAsset.path).not.toBe(wideAsset.path);
    expect(narrowAsset.path.endsWith(".png")).toBe(true);
    expect(wideAsset.path.endsWith(".png")).toBe(true);

    // Both survive the merge (asset record keys equal asset ids).
    const doc = buildDocument(frames, { slug: "figma-story" });
    expect(Object.keys(doc.assets).sort()).toEqual([
      "figma:1-1:background",
      "figma:2-2:background",
    ]);
    for (const [key, asset] of Object.entries(doc.assets)) {
      expect(asset.id).toBe(key);
    }
  });
});
