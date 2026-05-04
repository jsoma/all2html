/// <reference types="@figma/plugin-typings" />

import type { FontMapping, Paragraph, TextElement } from "../../../src/ir/types.js";
import { parseLayerType } from "./extract/layers.js";
import { figmaFontToMapping, segmentsToParagraphs, type FigmaTextSegment } from "./extract/text.js";
import { extractFrameInfo } from "./extract/frames.js";
import { makeFigmaArtboardId, makeFigmaLayerId } from "./ir-ids.js";
import type { ExtractedAsset, ExtractedFrame, ExtractedLayer } from "./types.js";

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

export function discoverTopLevelSpecialLayerNodes(
  frame: Pick<FrameNode, "children">,
): SpecialLayerCandidate[] {
  const candidates: SpecialLayerCandidate[] = [];

  for (const child of frame.children) {
    const parsed = parseLayerType(child.name);
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
  const segments = textNode.getStyledTextSegments([
    ...TEXT_SEGMENT_FIELDS,
  ]) as FigmaTextSegment[];
  warnings.push(...collectSegmentWarnings(segments, { name: textNode.name, id: textNode.id }));
  addSegmentFontMappings(segments, fontMappings);
  return segmentsToParagraphs(segments, { alignment: mapAlignment(textNode) });
}

function extractTextElement(
  textNode: TextNode,
  frame: FrameNode,
  warnings: string[],
  fontMappings: Map<string, FontMapping>,
): TextElement {
  const position = getNodeBoundsRelativeToFrame(textNode, frame);
  const paragraphs = extractParagraphs(textNode, warnings, fontMappings);
  const opacity = Math.round(textNode.opacity * 100);

  return {
    type: "text",
    id: makeTextId(textNode.id),
    kind: mapKind(textNode),
    position,
    rotation: textNode.rotation ? textNode.rotation * -1 : undefined,
    opacity,
    valign: mapValign(textNode),
    paragraphs,
    renderAs: "html",
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

function makeSpecialLayerBase(
  candidate: SpecialLayerCandidate,
): Omit<ExtractedLayer, "elements" | "sourceNodeId"> {
  return {
    name: candidate.name,
    type: candidate.type,
    inlineSvg: candidate.inlineSvg,
    visible: candidate.node.visible,
    opacity: Math.round((("opacity" in candidate.node ? candidate.node.opacity : 1) || 1) * 100),
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

function createBackgroundAsset(
  slug: string,
  frameInfo: ReturnType<typeof extractFrameInfo>,
  actualWidth: number,
  actualHeight: number,
  bytes: Uint8Array,
): ExtractedAsset {
  const keyword = makeKeyword(frameInfo.originalName || frameInfo.name);
  return {
    id: `bg-${keyword}`,
    path: `all2html-output/${slug}-${keyword}.png`,
    mimeType: "image/png",
    width: actualWidth,
    height: actualHeight,
    artboardId: makeFigmaArtboardId(frameInfo),
    source: {
      tool: "figma",
      id: frameInfo.sourceNodeId,
      name: frameInfo.originalName,
    },
    exportParams: { format: "png", scale: 1, transparent: false },
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
    transparent?: boolean;
  },
): ExtractedAsset {
  const artboardKeyword = makeAssetKeyword(frameInfo.originalName || frameInfo.name);
  const layerKeyword = makeAssetKeyword(layer.name);
  const width = ("width" in node ? node.width : frameInfo.width) ?? frameInfo.width;
  const height = ("height" in node ? node.height : frameInfo.height) ?? frameInfo.height;

  return {
    id: `${layer.type}-${artboardKeyword}-${layerKeyword}`,
    path: `all2html-output/${slug}-${artboardKeyword}-${layerKeyword}.${options.extension}`,
    mimeType: options.mimeType,
    width,
    height,
    artboardId: makeFigmaArtboardId(frameInfo),
    layerId: makeFigmaLayerId(frameInfo, layer),
    source: {
      tool: "figma",
      id: layer.sourceNodeId,
      name: layer.name,
    },
    exportParams: {
      format: options.extension,
      scale: 1,
      ...(options.transparent ? { transparent: true } : {}),
    },
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

  const elements = frameInfo.imageOnly
    ? []
    : textNodes
        .map((textNode) => extractTextElement(textNode, frameClone, warnings, fontMappings))
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
  if (candidate.type === "symbol" || candidate.type === "div") {
    warnings.push(makeSpecialLayerWarning(candidate, "is not supported in the Figma plugin yet and was skipped."));
    return { layer: null, assets: [] };
  }

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
            transparent: true,
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
            transparent: true,
          }),
        ],
      };
    }
    default:
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
      const movedClone = normalizeCloneTree(selected.clone());
      if (movedClone.type !== "FRAME") {
        movedClone.remove();
        warnings.push(`Skipped selected node "${selected.name}" because its clone did not remain a frame.`);
        continue;
      }

      tempRoot.appendChild(movedClone);
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
      const discovered = discoverTopLevelSpecialLayerNodes(movedClone);
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

      hideTextNodes(movedClone);
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
