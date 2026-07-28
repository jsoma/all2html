/// <reference types="@figma/plugin-typings" />

import type { FontMapping, Paragraph, TextElement } from "../../../src/ir/types.js";
import { extractFrameInfo } from "./extract/frames.js";
import { parseLayerType } from "./extract/layers.js";
import { type FigmaTextSegment, figmaFontToMapping, segmentsToParagraphs } from "./extract/text.js";
import { makeFigmaArtboardId, makeFigmaLayerId } from "./ir-ids.js";
import type { ExtractedAsset, ExtractedFrame, ExtractedLayer, FrameInfo } from "./types.js";

const TEXT_SEGMENT_FIELDS = [
  "fontName",
  "fontSize",
  "letterSpacing",
  "lineHeight",
  "fills",
  "textCase",
  "textDecoration",
  "hyperlink",
] as const;

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return "children" in node;
}

function isContainerWithLayout(node: SceneNode): node is FrameNode | ComponentNode | InstanceNode {
  return "layoutMode" in node;
}

function isExportableNode(node: SceneNode): node is SceneNode & ExportMixin {
  return "exportAsync" in node;
}

function makeKeyword(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function makeTextId(nodeId: string): string {
  return `figma-${nodeId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

function makeLayerToken(layer: Pick<ExtractedLayer, "type" | "inlineSvg">): string {
  if (layer.type === "svg" && layer.inlineSvg) {
    return ":svg:inline";
  }
  return `:${layer.type}`;
}

function makeSpecialLayerWarning(
  layer: Pick<ExtractedLayer, "name" | "type" | "inlineSvg">,
  reason: string,
): string {
  return `Layer "${layer.name}" tagged ${makeLayerToken(layer)} ${reason}`;
}

function makeAssetKeyword(input: string): string {
  return makeKeyword(input || "layer");
}

export interface SpecialLayerCandidate {
  node: SceneNode;
  name: string;
  type: ExtractedLayer["type"];
  inlineSvg: boolean;
}

/** The message a `:symbol` / `:div` node gets, since Figma cannot honor either. */
export function unsupportedLayerTokenWarning(nodeName: string, token: string): string {
  return `Layer "${nodeName}" tagged ${token} is not supported on Figma. The tag was ignored and the layer exported as ordinary artwork.`;
}

export function discoverTopLevelSpecialLayerNodes(
  frame: Pick<FrameNode, "children">,
  warnings?: string[],
): SpecialLayerCandidate[] {
  const candidates: SpecialLayerCandidate[] = [];

  for (const child of frame.children) {
    const parsed = parseLayerType(child.name);
    if (parsed.unsupportedToken) {
      warnings?.push(unsupportedLayerTokenWarning(child.name, parsed.unsupportedToken));
      continue;
    }
    if (parsed.type === "default") {
      continue;
    }
    candidates.push({
      node: child,
      name: parsed.cleanName,
      type: parsed.type,
      inlineSvg: parsed.inlineSvg,
    });
  }

  return candidates;
}

export function getNodeBoundsRelativeToFrame(
  node: Pick<SceneNode, "absoluteTransform"> & { width?: number; height?: number },
  frame: Pick<FrameNode, "absoluteTransform">,
) {
  return {
    x: node.absoluteTransform[0][2] - frame.absoluteTransform[0][2],
    y: node.absoluteTransform[1][2] - frame.absoluteTransform[1][2],
    width: ("width" in node ? node.width : 0) ?? 0,
    height: ("height" in node ? node.height : 0) ?? 0,
  };
}

function mapAlignment(node: TextNode): Paragraph["alignment"] {
  switch (node.textAlignHorizontal) {
    case "CENTER":
      return "center";
    case "RIGHT":
      return "right";
    case "JUSTIFIED":
      return "justify";
    default:
      return "left";
  }
}

function mapValign(node: TextNode): TextElement["valign"] {
  switch (node.textAlignVertical) {
    case "CENTER":
      return "middle";
    case "BOTTOM":
      return "bottom";
    default:
      return "top";
  }
}

export function mapTextAutoResizeToKind(
  textAutoResize: TextNode["textAutoResize"],
): TextElement["kind"] {
  // In Figma, only WIDTH_AND_HEIGHT behaves like true point text.
  // HEIGHT, NONE, and TRUNCATE all retain a fixed text box width and should wrap.
  return textAutoResize === "WIDTH_AND_HEIGHT" ? "point" : "area";
}

function mapKind(node: TextNode): TextElement["kind"] {
  return mapTextAutoResizeToKind(node.textAutoResize);
}

export function collectSegmentWarnings(
  segments: readonly FigmaTextSegment[],
  context: { name: string; id: string },
): string[] {
  const warnings: string[] = [];
  if (segments.some((segment) => segment.hyperlink?.type === "NODE")) {
    warnings.push(
      `Text node "${context.name}" uses a Figma node link, which all2html doesn't export yet. The text was exported without the link.`,
    );
  }
  return warnings;
}

function addSegmentFontMappings(
  segments: readonly FigmaTextSegment[],
  fontMappings: Map<string, FontMapping>,
): void {
  for (const segment of segments) {
    const mapping = figmaFontToMapping(segment.fontName);
    fontMappings.set(mapping.sourceFont, mapping);
  }
}

function extractParagraphs(
  textNode: TextNode,
  warnings: string[],
  fontMappings: Map<string, FontMapping>,
): Paragraph[] {
  const segments = textNode.getStyledTextSegments([...TEXT_SEGMENT_FIELDS]) as FigmaTextSegment[];
  warnings.push(...collectSegmentWarnings(segments, { name: textNode.name, id: textNode.id }));
  addSegmentFontMappings(segments, fontMappings);
  return segmentsToParagraphs(segments, { alignment: mapAlignment(textNode) });
}

function extractTextElement(
  textNode: TextNode,
  frame: FrameNode,
  warnings: string[],
  fontMappings: Map<string, FontMapping>,
  disposition: TextRenderDisposition,
): TextElement {
  const position = getNodeBoundsRelativeToFrame(textNode, frame);
  const paragraphs = extractParagraphs(textNode, warnings, fontMappings);
  const opacity = Math.round(textNode.opacity * 100);

  return {
    type: "text",
    id: makeTextId(textNode.id),
    kind: mapKind(textNode),
    position,
    // Omitted, not set to undefined: the document model must survive a JSON
    // round-trip, and assertJsonPure rejects explicit-undefined keys.
    ...(textNode.rotation ? { rotation: textNode.rotation * -1 } : {}),
    opacity,
    valign: mapValign(textNode),
    paragraphs,
    ...disposition,
  };
}

export function isValidVideoUrl(url: string): boolean {
  if (!/^https:\/\//i.test(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return /\.mp4$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function normalizeCloneTree(node: SceneNode): SceneNode {
  let working = node;
  if (working.type === "INSTANCE") {
    working = working.detachInstance();
  }

  if (isContainerWithLayout(working) && working.layoutMode !== "NONE") {
    working.layoutMode = "NONE";
  }

  if (hasChildren(working)) {
    const children = [...working.children];
    for (const child of children) {
      normalizeCloneTree(child);
    }
  }

  return working;
}

function walkVisibleTextNodes(node: SceneNode, nodes: TextNode[]): void {
  if (!node.visible) {
    return;
  }

  if (node.type === "TEXT") {
    nodes.push(node);
    return;
  }

  if (hasChildren(node)) {
    for (const child of node.children) {
      walkVisibleTextNodes(child, nodes);
    }
  }
}

function setNodeVisible(node: SceneNode, visible: boolean): void {
  node.visible = visible;
  if (hasChildren(node)) {
    for (const child of node.children) {
      setNodeVisible(child, visible);
    }
  }
}

function hideTextNodes(node: SceneNode): void {
  if (node.type === "TEXT") {
    node.visible = false;
    return;
  }

  if (hasChildren(node)) {
    for (const child of node.children) {
      hideTextNodes(child);
    }
  }
}

/**
 * The single image-only disposition. Two sites must agree on it: the IR builder
 * (`buildDefaultLayer` records image-only text with `renderAs: "image"`) and the
 * raster export (`extractFramesFromSelection` leaves exactly that text visible in
 * the clone so the background PNG contains it). When the two sites decided
 * independently, an image-only frame's text ended up in neither the IR nor the
 * exported raster.
 */
export function rendersTextIntoBackground(frameInfo: Pick<FrameInfo, "imageOnly">): boolean {
  return frameInfo.imageOnly === true;
}

type TextRenderDisposition =
  | { renderAs: "html" }
  | { renderAs: "image"; renderAsReason: "imageOnly" };

function makeSpecialLayerBase(
  candidate: SpecialLayerCandidate,
): Omit<ExtractedLayer, "elements" | "sourceNodeId"> {
  return {
    name: candidate.name,
    type: candidate.type,
    inlineSvg: candidate.inlineSvg,
    visible: candidate.node.visible,
    // Nullish, not `||`: opacity 0 is a valid value and must survive into the IR.
    opacity: Math.round((("opacity" in candidate.node ? candidate.node.opacity : 1) ?? 1) * 100),
  };
}

function getSpecialLayerTextValue(
  candidate: SpecialLayerCandidate,
  warnings: string[],
  requirement: string,
): string | null {
  const textNodes: TextNode[] = [];
  if (candidate.node.visible) {
    walkVisibleTextNodes(candidate.node, textNodes);
  }
  const result = resolveSpecialLayerTextValue(
    { ...candidate, visible: candidate.node.visible },
    textNodes.map((node) => node.characters),
    requirement,
  );
  if (result.warning) {
    warnings.push(result.warning);
  }
  return result.value;
}

export function resolveSpecialLayerTextValue(
  layer: Pick<ExtractedLayer, "name" | "type" | "inlineSvg" | "visible">,
  textValues: readonly string[],
  requirement: string,
): { value: string | null; warning: string | null } {
  if (!layer.visible) {
    return {
      value: null,
      warning: makeSpecialLayerWarning(layer, "is hidden and was skipped."),
    };
  }

  if (textValues.length !== 1) {
    return {
      value: null,
      warning: makeSpecialLayerWarning(
        layer,
        `needs one visible text node with ${requirement}. It was skipped.`,
      ),
    };
  }

  const value = textValues[0].trim();
  if (!value) {
    return {
      value: null,
      warning: makeSpecialLayerWarning(layer, `needs ${requirement}. It was skipped.`),
    };
  }

  return { value, warning: null };
}

/**
 * What `exportAsync({ format: "PNG" })` actually produces.
 *
 * The Figma image export takes no bit-depth, palette, or matte option
 * (`ExportSettingsImage` in @figma/plugin-typings is `format`, `contentsOnly`,
 * `useAbsoluteBounds`, `suffix`, `constraint`, `colorProfile`), so the result is
 * always a full-color PNG that preserves the node's alpha — i.e. `png24`,
 * transparent. No `constraint` is passed anywhere in this file, and the
 * documented default is `{ type: "SCALE", value: 1 }`, so the scale is 1.
 *
 * These are the same three facts `figmaCapabilities` declares in
 * `src/core/capabilities.ts` (`imageFormat` partial at png24,
 * `pngTransparent` divergesAtDefault true, `use2xImages` divergesAtDefault
 * false). The asset record and the declaration are pinned to each other by
 * `test/unit/figma-runtime.test.ts`; the two must not drift, because an
 * `exportParams` that misdescribes its own bytes is exactly the defect
 * `capability-matrix.md` cites as D1 evidence on Illustrator.
 */
const FIGMA_PNG_EXPORT_PARAMS = {
  format: "png24",
  scale: 1,
  transparent: true,
} as const;

/** Figma SVG export carries no background either. */
const FIGMA_SVG_EXPORT_PARAMS = {
  format: "svg",
  scale: 1,
  transparent: true,
} as const;

export const FIGMA_EXPORT_PARAMS = {
  png: FIGMA_PNG_EXPORT_PARAMS,
  svg: FIGMA_SVG_EXPORT_PARAMS,
} as const;

export function createBackgroundAsset(
  slug: string,
  frameInfo: ReturnType<typeof extractFrameInfo>,
  actualWidth: number,
  actualHeight: number,
  bytes: Uint8Array,
): ExtractedAsset {
  const keyword = makeKeyword(frameInfo.originalName || frameInfo.name);
  const artboardId = makeFigmaArtboardId(frameInfo);
  return {
    // Identity derives from the owning artboard's canonical id plus a role
    // suffix, never from display names: same-named frames are legal (they form
    // a responsive group), and name-derived ids collapsed their assets onto one
    // record.
    id: `${artboardId}:background`,
    // Asset paths are relative to `settings.imageOutputPath`, exactly like the
    // Illustrator exporter (`exporter.jsx` writes `imageName + ext`) and the SVG
    // importer. The output directory is applied twice, in two places that must
    // agree: `resolveAssetPath()` prefixes it into the emitted `src`, and
    // `createOutputBundle({ assetRoot })` prefixes it into the bundle layout.
    // Baking it in here instead made a non-default `imageOutputPath` emit HTML
    // pointing at a path the ZIP did not contain.
    // The readable slug keeps the filename recognizable; the owner id keeps it
    // unique across same-named frames.
    path: `${makeAssetKeyword(`${slug}-${keyword}-${artboardId}`)}.png`,
    mimeType: "image/png",
    width: actualWidth,
    height: actualHeight,
    artboardId,
    source: {
      tool: "figma",
      id: frameInfo.sourceNodeId,
      name: frameInfo.originalName,
    },
    exportParams: { ...FIGMA_PNG_EXPORT_PARAMS },
    bytes,
  };
}

function createSpecialLayerAsset(
  slug: string,
  frameInfo: ReturnType<typeof extractFrameInfo>,
  layer: Pick<ExtractedLayer, "name" | "type" | "sourceNodeId">,
  node: SceneNode,
  options: {
    bytes: Uint8Array;
    extension: "png" | "svg";
    mimeType: "image/png" | "image/svg+xml";
  },
): ExtractedAsset {
  const artboardKeyword = makeAssetKeyword(frameInfo.originalName || frameInfo.name);
  const layerKeyword = makeAssetKeyword(layer.name);
  const layerId = makeFigmaLayerId(frameInfo, layer);
  const width = ("width" in node ? node.width : frameInfo.width) ?? frameInfo.width;
  const height = ("height" in node ? node.height : frameInfo.height) ?? frameInfo.height;

  return {
    // Owner id plus role suffix — see `createBackgroundAsset` for why display
    // names cannot be the identity.
    id: `${layerId}:asset`,
    // Relative to `settings.imageOutputPath` — see `createBackgroundAsset`.
    path: `${makeAssetKeyword(`${slug}-${artboardKeyword}-${layerKeyword}-${layerId}`)}.${options.extension}`,
    mimeType: options.mimeType,
    width,
    height,
    artboardId: makeFigmaArtboardId(frameInfo),
    layerId,
    source: {
      tool: "figma",
      id: layer.sourceNodeId,
      name: layer.name,
    },
    // The file extension is not the format: Figma writes `.png` files that are
    // png24, so the record names the format it actually produced.
    exportParams: { ...FIGMA_EXPORT_PARAMS[options.extension] },
    bytes: options.bytes,
  };
}

function buildDefaultLayer(
  frameClone: FrameNode,
  frameInfo: ReturnType<typeof extractFrameInfo>,
  warnings: string[],
  fontMappings: Map<string, FontMapping>,
): ExtractedLayer {
  const textNodes: TextNode[] = [];
  walkVisibleTextNodes(frameClone, textNodes);

  // Same predicate as the raster-export site in `extractFramesFromSelection`:
  // image-only text is recorded as baked into the background raster; all other
  // text becomes live HTML and is hidden before the raster export.
  const disposition: TextRenderDisposition = rendersTextIntoBackground(frameInfo)
    ? { renderAs: "image", renderAsReason: "imageOnly" }
    : { renderAs: "html" };

  const elements = textNodes
    .map((textNode) =>
      extractTextElement(textNode, frameClone, warnings, fontMappings, disposition),
    )
    .sort((a, b) => {
      if (a.position.y !== b.position.y) return a.position.y - b.position.y;
      return a.position.x - b.position.x;
    });

  return {
    sourceNodeId: frameClone.id,
    name: "content",
    type: "default",
    inlineSvg: false,
    visible: true,
    opacity: 100,
    elements,
  };
}

export async function extractSpecialLayer(
  candidate: SpecialLayerCandidate,
  frameInfo: ReturnType<typeof extractFrameInfo>,
  slug: string,
  warnings: string[],
): Promise<{ layer: ExtractedLayer | null; assets: ExtractedAsset[] }> {
  const baseLayer = makeSpecialLayerBase(candidate);

  switch (candidate.type) {
    case "html-before":
    case "html-after": {
      const content = getSpecialLayerTextValue(candidate, warnings, "HTML content");
      if (!content) {
        return { layer: null, assets: [] };
      }

      return {
        layer: {
          sourceNodeId: candidate.node.id,
          ...baseLayer,
          elements: [{ type: "rawHtml", content }],
        },
        assets: [],
      };
    }
    case "video": {
      const url = getSpecialLayerTextValue(candidate, warnings, "an https://...mp4 URL");
      if (!url) {
        return { layer: null, assets: [] };
      }
      if (!isValidVideoUrl(url)) {
        warnings.push(
          makeSpecialLayerWarning(candidate, "needs an https://...mp4 URL. The layer was skipped."),
        );
        return { layer: null, assets: [] };
      }

      return {
        layer: {
          sourceNodeId: candidate.node.id,
          ...baseLayer,
          elements: [{ type: "video", url }],
        },
        assets: [],
      };
    }
    case "svg": {
      if (!candidate.node.visible) {
        warnings.push(makeSpecialLayerWarning(candidate, "is hidden and was skipped."));
        return { layer: null, assets: [] };
      }
      if (!isExportableNode(candidate.node)) {
        warnings.push(makeSpecialLayerWarning(candidate, "could not be exported and was skipped."));
        return { layer: null, assets: [] };
      }

      if (candidate.inlineSvg) {
        const content = await candidate.node.exportAsync({ format: "SVG_STRING" });
        return {
          layer: {
            sourceNodeId: candidate.node.id,
            ...baseLayer,
            // Inline SVG already carries node opacity in the exported markup.
            opacity: 100,
            elements: [{ type: "rawHtml", content }],
          },
          assets: [],
        };
      }

      const bytes = await candidate.node.exportAsync({ format: "SVG" });
      const layer: ExtractedLayer = {
        sourceNodeId: candidate.node.id,
        ...baseLayer,
        // Asset-backed SVG already carries node opacity in the exported bytes.
        opacity: 100,
        elements: [],
      };
      return {
        layer,
        assets: [
          createSpecialLayerAsset(slug, frameInfo, layer, candidate.node, {
            bytes,
            extension: "svg",
            mimeType: "image/svg+xml",
          }),
        ],
      };
    }
    case "png": {
      if (!candidate.node.visible) {
        warnings.push(makeSpecialLayerWarning(candidate, "is hidden and was skipped."));
        return { layer: null, assets: [] };
      }
      if (!isExportableNode(candidate.node)) {
        warnings.push(makeSpecialLayerWarning(candidate, "could not be exported and was skipped."));
        return { layer: null, assets: [] };
      }

      const bytes = await candidate.node.exportAsync({ format: "PNG" });
      const layer: ExtractedLayer = {
        sourceNodeId: candidate.node.id,
        ...baseLayer,
        // PNG overlay assets already carry node opacity in the exported bytes.
        opacity: 100,
        elements: [],
      };
      return {
        layer,
        assets: [
          createSpecialLayerAsset(slug, frameInfo, layer, candidate.node, {
            bytes,
            extension: "png",
            mimeType: "image/png",
          }),
        ],
      };
    }
    default:
      // `discoverTopLevelSpecialLayerNodes` only ever produces the types above:
      // `:symbol` / `:div` are rejected by the parser and `default` is filtered.
      // If a caller hands one in anyway, say so rather than dropping it.
      warnings.push(unsupportedLayerTokenWarning(candidate.name, makeLayerToken(candidate)));
      return { layer: null, assets: [] };
  }
}

export async function extractFramesFromSelection(
  selection: readonly FrameNode[],
  options: { slug: string },
): Promise<{ frames: ExtractedFrame[]; warnings: string[] }> {
  const warnings: string[] = [];
  const tempRoot = figma.createFrame();
  tempRoot.name = "[all2html export]";
  tempRoot.layoutMode = "NONE";
  tempRoot.clipsContent = false;
  tempRoot.x = -20000;
  tempRoot.y = -20000;
  figma.currentPage.appendChild(tempRoot);

  try {
    const extracted: ExtractedFrame[] = [];

    for (const selected of selection) {
      const clone = selected.clone();
      // Parent the clone into tempRoot before normalizing so the finally
      // cleanup covers it even if normalization throws mid-tree.
      tempRoot.appendChild(clone);
      const movedClone = normalizeCloneTree(clone);
      if (movedClone.type !== "FRAME") {
        movedClone.remove();
        warnings.push(
          `Skipped selected node "${selected.name}" because its clone did not remain a frame.`,
        );
        continue;
      }

      const frameInfo = extractFrameInfo({
        id: selected.id,
        name: selected.name,
        type: "FRAME",
        width: selected.width,
        height: selected.height,
        parent: { type: "PAGE" },
      });
      const specialLayersByIndex = new Map<number, ExtractedLayer>();
      const specialAssets: ExtractedAsset[] = [];
      const fontMappings = new Map<string, FontMapping>();
      const discovered = discoverTopLevelSpecialLayerNodes(movedClone, warnings);
      const children = [...movedClone.children];

      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const candidate = discovered.find((entry) => entry.node === child);
        if (!candidate) {
          continue;
        }

        const extractedSpecial = await extractSpecialLayer(
          candidate,
          frameInfo,
          options.slug,
          warnings,
        );
        if (extractedSpecial.layer) {
          specialLayersByIndex.set(index, extractedSpecial.layer);
        }
        specialAssets.push(...extractedSpecial.assets);
        setNodeVisible(child, false);
      }

      const defaultLayer = buildDefaultLayer(movedClone, frameInfo, warnings, fontMappings);
      const orderedLayers: ExtractedLayer[] = [];
      let defaultInserted = false;
      for (let index = 0; index < children.length; index++) {
        const specialLayer = specialLayersByIndex.get(index);
        if (specialLayer) {
          orderedLayers.push(specialLayer);
          continue;
        }
        if (!defaultInserted) {
          orderedLayers.push(defaultLayer);
          defaultInserted = true;
        }
      }
      if (!defaultInserted) {
        orderedLayers.push(defaultLayer);
      }

      // The other half of the disposition `buildDefaultLayer` used above:
      // image-only frames keep their text visible so the background raster
      // contains it; other frames hide text because it re-renders as live HTML.
      if (!rendersTextIntoBackground(frameInfo)) {
        hideTextNodes(movedClone);
      }
      const bytes = await movedClone.exportAsync({ format: "PNG" });

      extracted.push({
        ...frameInfo,
        actualWidth: selected.width,
        actualHeight: selected.height,
        layers: orderedLayers,
        fonts: [...fontMappings.values()],
        assets: [
          createBackgroundAsset(options.slug, frameInfo, selected.width, selected.height, bytes),
          ...specialAssets,
        ],
        metadata: { figmaNodeId: selected.id },
      });
    }

    return { frames: extracted, warnings };
  } finally {
    tempRoot.remove();
  }
}
