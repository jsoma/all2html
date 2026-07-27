import { parseSync, stringify } from "svgson";
import { makeKeyword } from "../../core/identifiers.js";
import {
  createWarning,
  type StructuredWarning,
  type WarningCategory,
} from "../../core/warnings.js";
import { isSafeUrl } from "../../emitters/shared/escape.js";
import { defaultSettings } from "../../ir/defaults.js";
import type {
  Artboard,
  Asset,
  CharacterRun,
  Color,
  Document,
  FontMapping,
  Paragraph,
  Settings,
  TextElement,
} from "../../ir/types.js";
import { CURRENT_IR_VERSION } from "../../ir/types.js";
import type { ImportedAssetFile, ImportedFile, ImportOptions, ImportResult } from "../types.js";
import { encodeRasterImage, type SvgRasterizer } from "./rasterizer.js";
import type { Matrix2D, MatrixRejectionReason } from "./transform.js";
import {
  describeAxisAlignedTransform,
  IDENTITY_MATRIX,
  isUnitScale,
  matricesEqual,
  multiplyMatrix,
  parseTransformList,
} from "./transform.js";

interface SvgNode {
  name: string;
  type: "element" | "text" | string;
  value: string;
  attributes: Record<string, string>;
  children: SvgNode[];
}

interface NamingInfo {
  rawStem: string;
  artboardName: string;
  originalName: string;
  responsiveness?: "fixed" | "dynamic";
  imageOnly?: boolean;
  ambiguousBase?: string;
}

interface StyleContext {
  fill?: string;
  color?: string;
  opacity: number;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  letterSpacing?: string;
  lineHeight?: string;
  textAnchor?: string;
  direction?: "ltr" | "rtl";
  visibility?: string;
  hyperlink?: string;
}

interface TransformContext {
  /** Composed transform from the SVG root down to (and including) this node. */
  matrix: Matrix2D;
  /** False once the composed transform stops being a translate + positive scale. */
  supported: boolean;
  reason?: MatrixRejectionReason;
}

/** Per-file state for one text-recovery scan. */
interface TextScanContext {
  state: ImportState;
  svgPath: string;
  /** Artboard bounds in SVG user units; used to drop off-canvas text. */
  bounds: { width: number; height: number };
  /** Visible text nodes the scan looked at (recovered or not). */
  consideredCount: number;
  /** Text content of visible in-bounds nodes that could not be recovered. */
  discardedText: string[];
}

interface TextLine {
  x: number;
  y: number;
  runs: CharacterRun[];
  width: number;
  maxFontSize: number;
  leading: number;
  anchor: "left" | "center" | "right";
}

interface ImportedTextNode {
  node: SvgNode;
  element: TextElement;
}

interface ImportState {
  /** Deduplicated by message; sorted on the way out so import output is stable. */
  warnings: StructuredWarning[];
  warningMessages: Set<string>;
  fonts: Map<string, FontMapping>;
  assetFiles: ImportedAssetFile[];
  writtenAssetPaths: Set<string>;
  extractedRefs: Map<string, string>;
}

const NON_RENDER_ROOT_TAGS = new Set(["defs", "style", "title", "desc", "metadata"]);
const UNSUPPORTED_TEXT_CONTAINERS = new Set(["mask", "clipPath", "pattern", "symbol"]);
const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  transparent: "rgba(0,0,0,0)",
};

function normalizeImportPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function dirnamePosix(path: string): string {
  const normalized = normalizeImportPath(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function basenamePosix(path: string): string {
  const normalized = normalizeImportPath(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function stripExtension(path: string): string {
  const file = basenamePosix(path);
  const index = file.lastIndexOf(".");
  return index >= 0 ? file.slice(0, index) : file;
}

function stripPathExtension(path: string): string {
  const normalized = normalizeImportPath(path);
  const slashIndex = normalized.lastIndexOf("/");
  const extensionIndex = normalized.lastIndexOf(".");
  if (extensionIndex > slashIndex) {
    return normalized.slice(0, extensionIndex);
  }
  return normalized;
}

function joinPosix(base: string, relativePath: string): string {
  const combined = `${base ? `${base}/` : ""}${relativePath}`.split("/");
  const parts: string[] = [];
  for (const segment of combined) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

function parseFileName(stem: string): NamingInfo {
  const recognized = /^(.*?)(?:(--)|:)(dynamic|image|\d+)$/i.exec(stem);
  if (!recognized) {
    return {
      rawStem: stem,
      artboardName: stem,
      originalName: stem,
    };
  }

  const baseName = recognized[1].trim();
  const suffix = recognized[3].toLowerCase();
  const info: NamingInfo = {
    rawStem: stem,
    artboardName: baseName || stem,
    originalName: stem,
  };

  if (suffix === "dynamic") {
    info.responsiveness = "dynamic";
    return info;
  }

  if (suffix === "image") {
    info.imageOnly = true;
    return info;
  }

  const width = Number.parseInt(suffix, 10);
  if (!Number.isNaN(width) && width > 0) {
    info.responsiveness = "fixed";
    return info;
  }

  return {
    rawStem: stem,
    artboardName: stem,
    originalName: stem,
    ambiguousBase: baseName,
  };
}

function addWarning(
  state: ImportState,
  code: string,
  category: WarningCategory,
  message: string,
  context?: { setting?: string },
): void {
  if (state.warningMessages.has(message)) return;
  state.warningMessages.add(message);
  state.warnings.push(createWarning(code, category, message, context));
}

function parseStyleAttribute(styleAttr: string | undefined): Record<string, string> {
  if (!styleAttr) return {};
  const result: Record<string, string> = {};
  for (const pair of styleAttr.split(";")) {
    const index = pair.indexOf(":");
    if (index < 0) continue;
    const key = pair.slice(0, index).trim().toLowerCase();
    const value = pair.slice(index + 1).trim();
    if (key && value) result[key] = value;
  }
  return result;
}

function getAttr(node: SvgNode, key: string): string | undefined {
  return node.attributes[key] ?? node.attributes[key.toLowerCase()];
}

function mergeStyleContext(parent: StyleContext, node: SvgNode): StyleContext {
  const styleMap = parseStyleAttribute(getAttr(node, "style"));
  const fill = getAttr(node, "fill") ?? styleMap.fill ?? parent.fill;
  const color = getAttr(node, "color") ?? styleMap.color ?? parent.color;
  const opacityRaw = getAttr(node, "opacity") ?? styleMap.opacity;
  const opacity =
    opacityRaw == null ? parent.opacity : parent.opacity * parseOpacity(opacityRaw, 1);
  const fontFamily = getAttr(node, "font-family") ?? styleMap["font-family"] ?? parent.fontFamily;
  const fontSize = getAttr(node, "font-size") ?? styleMap["font-size"] ?? parent.fontSize;
  const fontWeight = getAttr(node, "font-weight") ?? styleMap["font-weight"] ?? parent.fontWeight;
  const fontStyle = getAttr(node, "font-style") ?? styleMap["font-style"] ?? parent.fontStyle;
  const letterSpacing =
    getAttr(node, "letter-spacing") ?? styleMap["letter-spacing"] ?? parent.letterSpacing;
  const lineHeight = getAttr(node, "line-height") ?? styleMap["line-height"] ?? parent.lineHeight;
  const anchor =
    getAttr(node, "text-anchor") ?? styleMap["text-anchor"] ?? parent.textAnchor ?? "start";
  const direction =
    ((getAttr(node, "direction") ?? styleMap.direction ?? parent.direction) as
      | "ltr"
      | "rtl"
      | undefined) ?? "ltr";
  // `visibility` is inherited and a descendant may re-enable itself, unlike
  // `display: none`, which removes the whole subtree.
  const visibility = getAttr(node, "visibility") ?? styleMap.visibility ?? parent.visibility;
  const hyperlink = resolveNodeHyperlink(node) ?? parent.hyperlink;

  return {
    fill,
    color,
    opacity,
    fontFamily,
    fontSize,
    fontWeight,
    fontStyle,
    letterSpacing,
    lineHeight,
    textAnchor: anchor,
    direction,
    visibility,
    hyperlink,
  };
}

/**
 * `display: none` removes an element and its entire subtree from rendering,
 * regardless of what descendants declare. Illustrator uses it for hidden
 * layers, including the off-canvas `ai2html-settings` text block.
 */
function isDisplayNone(node: SvgNode): boolean {
  if (getAttr(node, "display")?.trim().toLowerCase() === "none") return true;
  return parseStyleAttribute(getAttr(node, "style")).display?.toLowerCase() === "none";
}

function collectTextContent(node: SvgNode): string {
  if (node.type === "text") return node.value;
  return node.children.map((child) => collectTextContent(child)).join("");
}

// Only <a> carries link semantics in SVG (href on <use>/<image> is a resource
// reference), and emitted hrefs land in output HTML, so unsafe schemes like
// javascript: must not survive import.
//
// This delegates to the shared `isSafeUrl` rather than scheme-matching locally.
// A local check that only trimmed the value was bypassable: browsers strip
// ASCII tabs and newlines from URLs before resolving, so `java&#x0A;script:`
// fails a `^scheme:` regex here, passes through as "no scheme detected", and
// then executes once the browser normalizes it away.
function resolveNodeHyperlink(node: SvgNode): string | undefined {
  if (node.name !== "a") return undefined;
  const href = (getAttr(node, "href") ?? getAttr(node, "xlink:href"))?.trim();
  if (!href) return undefined;
  if (!isSafeUrl(href)) return undefined;
  return href;
}

function parseOpacity(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const trimmed = raw.trim();
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) return fallback;
  const normalized = trimmed.endsWith("%") ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
}

function parseLength(raw: string | undefined, fallback: number, relativeTo?: number): number {
  if (raw == null || raw === "") return fallback;
  const trimmed = raw.trim();
  if (trimmed === "normal") return fallback;
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) return fallback;
  if (trimmed.endsWith("pt")) return (value * 96) / 72;
  if (trimmed.endsWith("em")) return relativeTo != null ? value * relativeTo : value * fallback;
  if (trimmed.endsWith("%")) return relativeTo != null ? (value / 100) * relativeTo : fallback;
  return value;
}

function parseLengthList(raw: string | undefined, relativeTo?: number): number[] | null {
  if (!raw) return null;
  const parts = raw
    .trim()
    .split(/[ ,]+/)
    .map((part) => parseLength(part, Number.NaN, relativeTo))
    .filter((part) => Number.isFinite(part));
  return parts.length > 0 ? parts : null;
}

function parseSvgDimensions(root: SvgNode): { width: number; height: number } {
  const viewBox = getAttr(root, "viewBox");
  const viewBoxParts = viewBox
    ?.trim()
    .split(/[ ,]+/)
    .map((part) => Number.parseFloat(part))
    .filter((part) => Number.isFinite(part));

  const width = parseLength(getAttr(root, "width"), viewBoxParts?.[2] ?? NaN);
  const height = parseLength(getAttr(root, "height"), viewBoxParts?.[3] ?? NaN);

  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }

  if (viewBoxParts && viewBoxParts.length === 4 && viewBoxParts[2] > 0 && viewBoxParts[3] > 0) {
    return { width: viewBoxParts[2], height: viewBoxParts[3] };
  }

  throw new Error("SVG is missing readable width/height or viewBox dimensions.");
}

/**
 * Compose a node's `transform` onto its inherited transform.
 *
 * A transform stays "supported" for live text recovery while it remains a
 * translation plus a positive axis-aligned scale. Rotation, skew, and mirroring
 * cannot be expressed as flowing HTML text and fall back to the raster.
 */
function mergeTransformContext(
  parent: TransformContext,
  raw: string | undefined,
): TransformContext {
  if (!parent.supported) {
    return parent;
  }

  const parsed = parseTransformList(raw);
  if (!parsed) {
    return { matrix: parent.matrix, supported: false, reason: "unparsed" };
  }

  const composed = multiplyMatrix(parent.matrix, parsed);
  const described = describeAxisAlignedTransform(composed);
  if (!described.supported) {
    return { matrix: composed, supported: false, reason: described.reason };
  }

  return { matrix: composed, supported: true };
}

/** Map a local x coordinate into artboard space (valid because `c === 0`). */
function mapX(matrix: Matrix2D, x: number): number {
  return matrix.a * x + matrix.e;
}

/** Map a local y coordinate into artboard space (valid because `b === 0`). */
function mapY(matrix: Matrix2D, y: number): number {
  return matrix.d * y + matrix.f;
}

function unsupportedTransformWarning(svgPath: string, reason: MatrixRejectionReason): string {
  if (reason === "mirrored") {
    return `${svgPath}: left mirrored or flipped text in SVG background asset.`;
  }
  return `${svgPath}: left transformed text in SVG background asset.`;
}

function parseColor(raw: string | undefined): Color | null {
  if (!raw || raw === "none") return null;
  let normalized = raw.trim().toLowerCase();
  normalized = NAMED_COLORS[normalized] ?? normalized;

  if (normalized.startsWith("#")) {
    const value = normalized.slice(1);
    if (value.length === 3 || value.length === 4) {
      const r = Number.parseInt(value[0] + value[0], 16);
      const g = Number.parseInt(value[1] + value[1], 16);
      const b = Number.parseInt(value[2] + value[2], 16);
      const alpha =
        value.length === 4
          ? Math.round((Number.parseInt(value[3] + value[3], 16) / 255) * 100)
          : undefined;
      return rgbColor(r, g, b, alpha);
    }
    if (value.length === 6 || value.length === 8) {
      const r = Number.parseInt(value.slice(0, 2), 16);
      const g = Number.parseInt(value.slice(2, 4), 16);
      const b = Number.parseInt(value.slice(4, 6), 16);
      const alpha =
        value.length === 8
          ? Math.round((Number.parseInt(value.slice(6, 8), 16) / 255) * 100)
          : undefined;
      return rgbColor(r, g, b, alpha);
    }
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(normalized);
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => part.trim());
    if (parts.length >= 3) {
      const r = Number.parseFloat(parts[0]);
      const g = Number.parseFloat(parts[1]);
      const b = Number.parseFloat(parts[2]);
      const alpha = parts.length >= 4 ? Math.round(Number.parseFloat(parts[3]) * 100) : undefined;
      if ([r, g, b].every((part) => Number.isFinite(part))) {
        return rgbColor(r, g, b, alpha);
      }
    }
  }

  return null;
}

/**
 * Build a colour with the alpha channel *omitted* when the source had none.
 *
 * `{ r, g, b, opacity: undefined }` is not the same document as `{ r, g, b }`:
 * `JSON.stringify` drops the key, so the model stopped surviving the round trip
 * it is required to survive. `assertJsonPure` only looked for non-finite numbers
 * at the time, so nothing caught it.
 */
function rgbColor(r: number, g: number, b: number, opacity: number | undefined): Color {
  return opacity === undefined ? { r, g, b } : { r, g, b, opacity };
}

function hasDescendant(node: SvgNode, tagName: string): boolean {
  return node.children.some(
    (child) =>
      child.type === "element" && (child.name === tagName || hasDescendant(child, tagName)),
  );
}

function estimateTextWidth(text: string, fontSize: number, letterSpacingEm: number): number {
  const glyphs = Array.from(text);
  let width = 0;
  for (const glyph of glyphs) {
    width += glyph === " " ? fontSize * 0.33 : fontSize * 0.56;
  }
  width += Math.max(glyphs.length - 1, 0) * letterSpacingEm * fontSize;
  return Math.max(width, fontSize * 0.5);
}

function createFontMapping(
  state: ImportState,
  family: string,
  weight: string,
  style: string,
): string {
  const primaryFamily =
    family
      .split(",")[0]
      ?.replace(/^['"]|['"]$/g, "")
      .trim() || "sans-serif";
  const fontName = `${primaryFamily}__${weight || "400"}__${style || "normal"}`;

  if (!state.fonts.has(fontName)) {
    state.fonts.set(fontName, {
      sourceFont: fontName,
      family,
      weight,
      style,
    });
  }

  return fontName;
}

function newTextLine(x: number, y: number, anchor: "left" | "center" | "right"): TextLine {
  return {
    x,
    y,
    runs: [],
    width: 0,
    maxFontSize: 0,
    leading: 0,
    anchor,
  };
}

function anchorToAlignment(anchor: string | undefined): "left" | "center" | "right" {
  if (anchor === "middle") return "center";
  if (anchor === "end") return "right";
  return "left";
}

function normalizeTextContent(text: string): string[] {
  return text.replace(/\r/g, "").split("\n");
}

function collectTextLines(
  scan: TextScanContext,
  node: SvgNode,
  context: StyleContext,
  transformContext: TransformContext,
  currentLine: TextLine,
  lines: TextLine[],
): TextLine {
  let activeLine = currentLine;
  // Guaranteed axis-aligned: the caller rejected rotation, skew, and mirroring.
  const verticalScale = transformContext.matrix.d;

  for (const child of node.children) {
    if (child.type === "text") {
      const segments = normalizeTextContent(child.value);
      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        if (!segment) {
          if (index < segments.length - 1) {
            const nextY = activeLine.y + (activeLine.leading || activeLine.maxFontSize * 1.2 || 16);
            activeLine = newTextLine(activeLine.x, nextY, activeLine.anchor);
            lines.push(activeLine);
          }
          continue;
        }

        // Lengths come out of the SVG in the node's local space; the vertical
        // scale folds into font size, and the horizontal stretch relative to it
        // is carried separately as a CSS transform on the element.
        const localFontSize = parseLength(context.fontSize, 16);
        const localLineHeight = parseLength(context.lineHeight, localFontSize * 1.2, localFontSize);
        const localLetterSpacing = parseLength(context.letterSpacing, 0, localFontSize);
        const fontSize = localFontSize * verticalScale;
        const lineHeight = localLineHeight * verticalScale;
        const weight = context.fontWeight?.trim() || "400";
        const style = context.fontStyle?.trim() || "normal";
        const family = context.fontFamily?.trim() || "sans-serif";
        const letterSpacingEm = localFontSize ? localLetterSpacing / localFontSize : 0;
        const preferredColorValue =
          context.fill?.trim().toLowerCase() === "none"
            ? context.color
            : (context.fill ?? context.color ?? "#000000");
        const color =
          parseColor(preferredColorValue) ??
          (context.fill?.trim().toLowerCase() === "none"
            ? { r: 0, g: 0, b: 0, opacity: 0 }
            : { r: 0, g: 0, b: 0 });
        const fontName = createFontMapping(scan.state, family, weight, style);
        const run: CharacterRun = {
          text: segment,
          fontName,
          fontSize,
          color,
          letterSpacing: letterSpacingEm,
          capitalization: "normal",
          baselineShift: "normal",
          // Absent, not `undefined`: the document model must survive JSON.
          ...(context.hyperlink ? { hyperlink: { href: context.hyperlink } } : {}),
        };

        activeLine.runs.push(run);
        activeLine.maxFontSize = Math.max(activeLine.maxFontSize, fontSize);
        activeLine.leading = Math.max(activeLine.leading, lineHeight);
        activeLine.width += estimateTextWidth(segment, fontSize, letterSpacingEm);

        if (index < segments.length - 1) {
          const nextY = activeLine.y + lineHeight;
          activeLine = newTextLine(activeLine.x, nextY, activeLine.anchor);
          lines.push(activeLine);
        }
      }
      continue;
    }

    if (child.type !== "element") continue;
    if (child.name === "textPath") {
      throw new Error("Text paths are not recoverable as live HTML text.");
    }

    const childContext = mergeStyleContext(context, child);
    const fontSize = parseLength(childContext.fontSize, 16);
    const xValues = parseLengthList(getAttr(child, "x"), fontSize);
    const yValues = parseLengthList(getAttr(child, "y"), fontSize);
    const dyValues = parseLengthList(getAttr(child, "dy"), fontSize);
    const childTransform = mergeTransformContext(transformContext, getAttr(child, "transform"));

    const multiPositioned =
      (xValues && xValues.length > 1) ||
      (yValues && yValues.length > 1) ||
      (dyValues && dyValues.length > 1);
    if (multiPositioned) {
      throw new Error("Per-glyph positioned text is not recoverable as live HTML text.");
    }
    if (
      !childTransform.supported ||
      !matricesEqual(childTransform.matrix, transformContext.matrix)
    ) {
      throw new Error("Transformed nested text is not recoverable as live HTML text.");
    }

    const startsNewLine =
      child.name === "tspan" &&
      ((xValues != null && activeLine.runs.length > 0) || yValues != null || dyValues != null);

    const repositionsCurrentLine =
      child.name === "tspan" &&
      activeLine.runs.length === 0 &&
      (xValues != null || yValues != null || dyValues != null);

    if (startsNewLine) {
      const nextX = xValues?.[0] != null ? mapX(transformContext.matrix, xValues[0]) : activeLine.x;
      const dy =
        dyValues?.[0] != null
          ? dyValues[0] * verticalScale
          : activeLine.leading || activeLine.maxFontSize * 1.2 || 16;
      const nextY =
        yValues?.[0] != null ? mapY(transformContext.matrix, yValues[0]) : activeLine.y + dy;
      activeLine = newTextLine(nextX, nextY, activeLine.anchor);
      lines.push(activeLine);
    } else if (repositionsCurrentLine) {
      if (xValues?.[0] != null) {
        activeLine.x = mapX(transformContext.matrix, xValues[0]);
      }
      if (yValues?.[0] != null) {
        activeLine.y = mapY(transformContext.matrix, yValues[0]);
      } else if (dyValues?.[0] != null) {
        activeLine.y += dyValues[0] * verticalScale;
      }
    }

    activeLine = collectTextLines(scan, child, childContext, childTransform, activeLine, lines);
  }

  return activeLine;
}

type TextBuildResult =
  /** Recovered as live HTML text. */
  | { kind: "element"; element: TextElement }
  /** Visible in the raster but not recoverable; its content can seed alt text. */
  | { kind: "discarded" }
  /** Nothing a reader would ever see (empty, or entirely off the artboard). */
  | { kind: "invisible" };

function buildTextElement(
  scan: TextScanContext,
  node: SvgNode,
  inherited: StyleContext,
  transform: TransformContext,
  index: number,
): TextBuildResult {
  const { state, svgPath } = scan;

  if (hasDescendant(node, "textPath")) {
    addWarning(
      state,
      "import:path-text",
      "text",
      `${svgPath}: skipped live text recovery for path text.`,
    );
    return { kind: "discarded" };
  }

  if (!transform.supported) {
    const reason = transform.reason ?? "unparsed";
    addWarning(
      state,
      reason === "mirrored" ? "import:mirrored-text" : "import:transformed-text",
      "text",
      unsupportedTransformWarning(svgPath, reason),
    );
    return { kind: "discarded" };
  }

  const context = mergeStyleContext(inherited, node);
  const fontSize = parseLength(context.fontSize, 16);
  const xValues = parseLengthList(getAttr(node, "x"), fontSize);
  const yValues = parseLengthList(getAttr(node, "y"), fontSize);
  if ((xValues && xValues.length > 1) || (yValues && yValues.length > 1)) {
    addWarning(
      state,
      "import:positioned-text",
      "text",
      `${svgPath}: skipped positioned text that cannot map cleanly to HTML.`,
    );
    return { kind: "discarded" };
  }

  // Per SVG, absent x/y default to 0. Illustrator relies on that and carries the
  // real position in the node's transform matrix instead.
  const localX = xValues?.[0] ?? 0;
  const localY = yValues?.[0] ?? 0;

  const anchor = anchorToAlignment(context.textAnchor);
  const baseLine = newTextLine(
    mapX(transform.matrix, localX),
    mapY(transform.matrix, localY),
    anchor,
  );
  const lines = [baseLine];

  try {
    collectTextLines(scan, node, context, transform, baseLine, lines);
  } catch (error) {
    addWarning(
      state,
      "import:text-layout",
      "text",
      `${svgPath}: ${error instanceof Error ? error.message : "Skipped unsupported text layout."}`,
    );
    return { kind: "discarded" };
  }

  const populatedLines = lines.filter((line) => line.runs.length > 0);
  if (populatedLines.length === 0) {
    return { kind: "invisible" };
  }

  const firstLine = populatedLines[0];
  const width = Math.max(...populatedLines.map((line) => line.width));
  const totalHeight = populatedLines.reduce(
    (sum, line) => sum + (line.leading || line.maxFontSize * 1.2),
    0,
  );
  const alignment = firstLine.anchor;
  const top = firstLine.y - firstLine.maxFontSize;
  const left =
    alignment === "center"
      ? firstLine.x - width / 2
      : alignment === "right"
        ? firstLine.x - width
        : firstLine.x;

  // Vertical scale is already folded into font size; what remains is the
  // horizontal stretch relative to it (Illustrator's horizontal-scale slider).
  const horizontalStretch = transform.matrix.a / transform.matrix.d;
  const stretched = !isUnitScale(horizontalStretch);
  const renderedWidth = width * (stretched ? horizontalStretch : 1);

  // The raster clips to the artboard, so text entirely outside it must not be
  // resurrected as live HTML clamped back onto the canvas. The stretch is
  // applied around the alignment anchor, so measure from there.
  const renderedLeft =
    alignment === "center"
      ? firstLine.x - renderedWidth / 2
      : alignment === "right"
        ? firstLine.x - renderedWidth
        : firstLine.x;
  if (
    renderedLeft + renderedWidth <= 0 ||
    top + totalHeight <= 0 ||
    renderedLeft >= scan.bounds.width ||
    top >= scan.bounds.height
  ) {
    addWarning(
      state,
      "import:offscreen-text",
      "text",
      `${svgPath}: left text positioned outside the artboard in the background asset.`,
    );
    return { kind: "invisible" };
  }

  const paragraphs: Paragraph[] = populatedLines.map((line) => ({
    text: line.runs.map((run) => run.text).join(""),
    alignment,
    direction: context.direction,
    leading: Math.max(line.leading || line.maxFontSize * 1.2, 1),
    spaceBefore: 0,
    spaceAfter: 0,
    runs: line.runs,
  }));

  const element: TextElement = {
    type: "text",
    id: `${makeKeyword(stripExtension(svgPath) || "svg")}-text-${index}`,
    kind: "point",
    position: {
      x: Math.max(left, 0),
      y: Math.max(top, 0),
      width: Math.max(width, 1),
      height: Math.max(totalHeight, firstLine.maxFontSize),
    },
    opacity: Math.max(0, Math.min(100, Math.round(context.opacity * 100))),
    valign: "top",
    paragraphs,
    renderAs: "html",
  };

  if (stretched) {
    element.transformMatrix = [horizontalStretch, 0, 0, 1, 0, 0];
  }

  return { kind: "element", element };
}

function collectRecoverableText(
  scan: TextScanContext,
  node: SvgNode,
  parentContext: StyleContext,
  parentTransform: TransformContext,
  parentTag?: string,
  extracted: ImportedTextNode[] = [],
): ImportedTextNode[] {
  if (node.type !== "element") return extracted;
  // `display: none` hides the whole subtree — Illustrator uses it for hidden
  // layers and for the off-canvas ai2html settings block.
  if (isDisplayNone(node)) return extracted;

  const context = mergeStyleContext(parentContext, node);
  const transform = mergeTransformContext(parentTransform, getAttr(node, "transform"));

  if (node.name === "text") {
    if (
      !UNSUPPORTED_TEXT_CONTAINERS.has(parentTag || "") &&
      context.visibility?.trim().toLowerCase() !== "hidden"
    ) {
      scan.consideredCount += 1;
      const result = buildTextElement(scan, node, parentContext, transform, extracted.length + 1);
      if (result.kind === "element") {
        extracted.push({ node, element: result.element });
      } else if (result.kind === "discarded") {
        const content = collectTextContent(node).replace(/\s+/g, " ").trim();
        if (content) scan.discardedText.push(content);
      }
    }
    return extracted;
  }

  for (const child of node.children) {
    collectRecoverableText(scan, child, context, transform, node.name, extracted);
  }

  return extracted;
}

function toUint8Array(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/svg+xml") return "svg";
  return "bin";
}

function inferMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function decodeDataUrl(url: string): { mimeType: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(url);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const encoded = match[3] || "";
  const bytes =
    match[2] === ";base64"
      ? decodeBase64(encoded)
      : new TextEncoder().encode(decodeURIComponent(encoded));
  return { mimeType, bytes };
}

function encodeDataUrl(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${encodeBase64(bytes)}`;
}

function decodeBase64(encoded: string): Uint8Array {
  const atobFn = (globalThis as { atob?: (data: string) => string }).atob;
  if (typeof atobFn === "function") {
    const decoded = atobFn(encoded);
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  }

  const bufferCtor = (
    globalThis as { Buffer?: { from: (value: string, encoding: string) => Uint8Array } }
  ).Buffer;
  if (bufferCtor?.from) {
    return Uint8Array.from(bufferCtor.from(encoded, "base64"));
  }

  throw new Error("No base64 decoder is available in the current runtime.");
}

function encodeBase64(bytes: Uint8Array): string {
  const bufferCtor = (
    globalThis as {
      Buffer?: { from: (value: Uint8Array) => { toString: (encoding: string) => string } };
    }
  ).Buffer;
  if (bufferCtor?.from) {
    return bufferCtor.from(bytes).toString("base64");
  }

  const btoaFn = (globalThis as { btoa?: (data: string) => string }).btoa;
  if (typeof btoaFn === "function") {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoaFn(binary);
  }

  throw new Error("No base64 encoder is available in the current runtime.");
}

function reserveAssetPath(state: ImportState, preferred: string): string {
  const normalized = normalizeImportPath(preferred);
  if (!state.writtenAssetPaths.has(normalized)) {
    state.writtenAssetPaths.add(normalized);
    return normalized;
  }

  const dot = normalized.lastIndexOf(".");
  const base = dot >= 0 ? normalized.slice(0, dot) : normalized;
  const ext = dot >= 0 ? normalized.slice(dot) : "";
  let counter = 2;
  while (state.writtenAssetPaths.has(`${base}-${counter}${ext}`)) counter++;
  const next = `${base}-${counter}${ext}`;
  state.writtenAssetPaths.add(next);
  return next;
}

function resolveImageHrefForRendering(
  state: ImportState,
  svgPath: string,
  node: SvgNode,
  filesByPath: Map<string, ImportedFile>,
): string | null {
  const hrefKey =
    node.attributes.href != null
      ? "href"
      : node.attributes["xlink:href"] != null
        ? "xlink:href"
        : null;
  if (!hrefKey) return null;
  const href = node.attributes[hrefKey];
  if (!href || href.startsWith("#")) return href ?? null;

  const cacheKey = `${svgPath}::${href}`;
  const existing = state.extractedRefs.get(cacheKey);
  if (existing) {
    return existing;
  }

  if (href.startsWith("data:")) {
    const decoded = decodeDataUrl(href);
    if (!decoded) {
      addWarning(
        state,
        "import:image-decode",
        "image",
        `${svgPath}: could not decode embedded SVG image data.`,
      );
      return href;
    }
    const dataUrl = encodeDataUrl(decoded.mimeType, decoded.bytes);
    state.extractedRefs.set(cacheKey, dataUrl);
    return dataUrl;
  }

  if (/^[a-z]+:/i.test(href)) {
    addWarning(
      state,
      "import:external-image",
      "image",
      `${svgPath}: leaving external image reference ${href} in imported SVG.`,
    );
    return href;
  }

  const resolved = resolveLinkedAssetPath(svgPath, href);
  const source = filesByPath.get(resolved);
  if (!source) {
    addWarning(
      state,
      "import:missing-image",
      "image",
      `${svgPath}: missing linked image asset ${href}.`,
    );
    return href;
  }

  const sourceBytes = toUint8Array(source.content);
  const mimeType = source.mimeType ?? inferMimeType(resolved);
  const dataUrl = encodeDataUrl(mimeType, sourceBytes);
  state.extractedRefs.set(cacheKey, dataUrl);
  return dataUrl;
}

function containsRasterImageNode(node: SvgNode, svgPath: string): boolean {
  if (node.type !== "element") return false;
  if (node.name === "image") {
    const href = node.attributes.href ?? node.attributes["xlink:href"];
    if (!href) return false;
    if (href.startsWith("data:")) {
      const decoded = decodeDataUrl(href);
      return decoded ? decoded.mimeType !== "image/svg+xml" : true;
    }
    if (/^[a-z]+:/i.test(href)) {
      return !href.toLowerCase().endsWith(".svg");
    }
    const resolved = resolveLinkedAssetPath(svgPath, href);
    return inferMimeType(resolved) !== "image/svg+xml";
  }
  return node.children.some((child) => containsRasterImageNode(child, svgPath));
}

function buildBackgroundSvg(
  state: ImportState,
  svgPath: string,
  node: SvgNode,
  recoveredTextNodes: Set<SvgNode>,
  filesByPath: Map<string, ImportedFile>,
): SvgNode | null {
  if (recoveredTextNodes.has(node)) {
    return null;
  }

  if (node.type !== "element") {
    return node;
  }

  const clone: SvgNode = {
    ...node,
    attributes: { ...node.attributes },
    children: [],
  };

  if (clone.name === "image") {
    const hrefKey =
      clone.attributes.href != null
        ? "href"
        : clone.attributes["xlink:href"] != null
          ? "xlink:href"
          : null;
    if (hrefKey) {
      const resolvedHref = resolveImageHrefForRendering(state, svgPath, clone, filesByPath);
      if (resolvedHref) clone.attributes[hrefKey] = resolvedHref;
    }
  }

  clone.children = node.children
    .map((child) => buildBackgroundSvg(state, svgPath, child, recoveredTextNodes, filesByPath))
    .filter((child): child is SvgNode => child != null);

  return clone;
}

function hasRenderableContent(node: SvgNode, insideDefs: boolean = false): boolean {
  if (node.type !== "element") return false;
  const nowInsideDefs = insideDefs || NON_RENDER_ROOT_TAGS.has(node.name);
  if (!nowInsideDefs && node.name !== "svg") {
    return true;
  }
  return node.children.some((child) => hasRenderableContent(child, nowInsideDefs));
}

function ensureSvgNamespaces(root: SvgNode): void {
  if (root.name !== "svg") return;
  if (!root.attributes.xmlns) {
    root.attributes.xmlns = "http://www.w3.org/2000/svg";
  }
  if (!root.attributes["xmlns:xlink"]) {
    const hasXLink = root.children.some((child) => containsXLinkHref(child));
    if (hasXLink) {
      root.attributes["xmlns:xlink"] = "http://www.w3.org/1999/xlink";
    }
  }
}

function containsXLinkHref(node: SvgNode): boolean {
  if (node.type !== "element") return false;
  if (node.attributes["xlink:href"]) return true;
  return node.children.some((child) => containsXLinkHref(child));
}

function resolveBackgroundImageFormat(
  requestedFormat: string | undefined,
  hasRasterContent: boolean,
  state: ImportState,
  svgPath: string,
): "png" | "png24" | "jpg" {
  if (requestedFormat && requestedFormat !== "auto") {
    if (requestedFormat === "svg") {
      addWarning(
        state,
        "setting:unsupported",
        "setting",
        `${svgPath}: SVG background export is not supported for imported SVG artboards; using png instead.`,
        { setting: "imageFormat" },
      );
      return "png";
    }
    return requestedFormat as "png" | "png24" | "jpg";
  }
  return hasRasterContent ? "jpg" : "png";
}

async function rasterizeBackgroundSvg(
  svgContent: string,
  format: "png" | "png24" | "jpg",
  settings: Settings,
  rasterizer: SvgRasterizer,
): Promise<{ bytes: Uint8Array; mimeType: string; width: number; height: number }> {
  const rendered = await rasterizer.rasterizeSvg({
    svgContent,
    scale: settings.use2xImages ? 2 : 1,
  });
  return encodeRasterImage(rendered, format, settings);
}

function createInitialContext(): StyleContext {
  return {
    fill: "#000000",
    color: "#000000",
    opacity: 1,
    direction: "ltr",
    textAnchor: "start",
  };
}

function createInitialTransformContext(): TransformContext {
  return {
    matrix: { ...IDENTITY_MATRIX },
    supported: true,
  };
}

const MAX_SYNTHESIZED_ALT_TEXT_LENGTH = 240;

/**
 * Build placeholder alt text for a graphic that ended up as a flat image.
 * Prefers the text that was discarded during recovery, falls back to the
 * artboard name. Always paired with a warning telling the user to review it.
 */
function synthesizeImageAltText(discardedText: readonly string[], artboardName: string): string {
  const joined = discardedText.join(" ").replace(/\s+/g, " ").trim();
  if (!joined) return artboardName;
  if (joined.length <= MAX_SYNTHESIZED_ALT_TEXT_LENGTH) return joined;
  return `${joined.slice(0, MAX_SYNTHESIZED_ALT_TEXT_LENGTH - 1).trimEnd()}…`;
}

function stripHrefQueryAndFragment(href: string): string {
  const queryIndex = href.indexOf("?");
  const fragmentIndex = href.indexOf("#");
  const cutoff =
    queryIndex >= 0 && fragmentIndex >= 0
      ? Math.min(queryIndex, fragmentIndex)
      : queryIndex >= 0
        ? queryIndex
        : fragmentIndex;
  return cutoff >= 0 ? href.slice(0, cutoff) : href;
}

function resolveLinkedAssetPath(svgPath: string, href: string): string {
  const sanitizedHref = stripHrefQueryAndFragment(href);
  let decodedHref = sanitizedHref;
  try {
    decodedHref = decodeURIComponent(sanitizedHref);
  } catch {
    decodedHref = sanitizedHref;
  }
  return joinPosix(dirnamePosix(svgPath), decodedHref);
}

async function parseSvgFile(
  state: ImportState,
  file: ImportedFile,
  filesByPath: Map<string, ImportedFile>,
  naming: NamingInfo,
  settings: Settings,
  rasterizer: SvgRasterizer,
): Promise<{
  artboard: Artboard;
  backgroundAsset?: Asset;
  backgroundFile?: ImportedAssetFile;
  imageAltText?: string;
}> {
  const svgContent =
    typeof file.content === "string" ? file.content : new TextDecoder().decode(file.content);
  const root = parseSync(svgContent) as SvgNode;
  if (root.name !== "svg") {
    throw new Error(`${file.path}: input is not a valid SVG document.`);
  }

  const dimensions = parseSvgDimensions(root);
  const artboardId = `artboard:${makeKeyword(stripPathExtension(file.path), "artboard")}`;
  const contentLayerId = `${artboardId}:layer:content`;
  const shouldRecoverText = !naming.imageOnly && settings.renderTextAs !== "image";
  const scan: TextScanContext = {
    state,
    svgPath: file.path,
    bounds: dimensions,
    consideredCount: 0,
    discardedText: [],
  };
  const extractedText = shouldRecoverText
    ? collectRecoverableText(scan, root, createInitialContext(), createInitialTransformContext())
    : [];
  const recoveredTextNodes = new Set(extractedText.map((entry) => entry.node));

  const textRecoveryFailed =
    shouldRecoverText && extractedText.length === 0 && scan.consideredCount > 0;
  if (textRecoveryFailed) {
    addWarning(
      state,
      "import:text-recovery-failed",
      "text",
      `${file.path}: no live HTML text could be recovered from SVG text nodes.`,
    );
  }

  if (
    svgContent.includes("<filter") ||
    svgContent.includes("clipPath") ||
    svgContent.includes("<mask")
  ) {
    addWarning(
      state,
      "import:preserved-effects",
      "image",
      `${file.path}: preserving filters, masks, or clip paths inside SVG asset output.`,
    );
  }

  const backgroundRoot = buildBackgroundSvg(
    state,
    file.path,
    root,
    recoveredTextNodes,
    filesByPath,
  );
  let backgroundAsset: Asset | undefined;
  let backgroundFile: ImportedAssetFile | undefined;

  if (backgroundRoot && hasRenderableContent(backgroundRoot)) {
    ensureSvgNamespaces(backgroundRoot);
    const requestedFormat = settings.imageFormat?.[0];
    const resolvedFormat = resolveBackgroundImageFormat(
      requestedFormat,
      containsRasterImageNode(backgroundRoot, file.path),
      state,
      file.path,
    );
    const rasterized = await rasterizeBackgroundSvg(
      stringify(backgroundRoot),
      resolvedFormat,
      settings,
      rasterizer,
    );
    const backgroundPath = reserveAssetPath(
      state,
      `${makeKeyword(stripExtension(file.path) || "svg")}.${extensionForMimeType(rasterized.mimeType)}`,
    );
    backgroundFile = {
      path: backgroundPath,
      bytes: rasterized.bytes,
      mimeType: rasterized.mimeType,
    };
    backgroundAsset = {
      id: backgroundPath,
      path: backgroundPath,
      mimeType: rasterized.mimeType,
      width: rasterized.width,
      height: rasterized.height,
      artboardId,
      source: {
        tool: "svg",
        id: file.path,
        name: naming.originalName,
      },
      // Format-specific parameters are *omitted* for the formats they do not
      // apply to. Writing `quality: undefined` on a PNG left an enumerable key
      // that JSON.stringify drops, so the asset record did not round-trip.
      exportParams: {
        format: extensionForMimeType(rasterized.mimeType) as "png" | "jpg",
        scale: settings.use2xImages ? 2 : 1,
        ...(rasterized.mimeType === "image/png"
          ? { transparent: settings.pngTransparent || false }
          : {}),
        ...(rasterized.mimeType === "image/jpeg" ? { quality: settings.jpgQuality || 85 } : {}),
        ...(rasterized.mimeType === "image/png" && resolvedFormat === "png"
          ? { colors: settings.pngNumberOfColors || 128 }
          : {}),
      },
    };
  }

  const layers = [];
  if (extractedText.length > 0) {
    layers.push({
      id: contentLayerId,
      name: "content",
      type: "default" as const,
      source: {
        tool: "svg",
        id: `${file.path}#content`,
        name: "content",
      },
      inlineSvg: false,
      visible: true,
      opacity: 100,
      elements: extractedText.map((entry) => entry.element),
    });
  }

  if (layers.length === 0 && !backgroundAsset) {
    throw new Error(`${file.path}: no importable content was found.`);
  }

  // A graphic that rasterized every one of its text objects would otherwise ship
  // with alt="". Seed alt text from the discarded copy so the output is at least
  // describable, and tell the user to review it.
  let imageAltText: string | undefined;
  if (textRecoveryFailed && backgroundAsset) {
    imageAltText = synthesizeImageAltText(scan.discardedText, naming.artboardName);
    addWarning(
      state,
      "import:placeholder-alt-text",
      "text",
      `${file.path}: generated placeholder image alt text; review metadata.imageAltText before publishing.`,
    );
  }

  return {
    artboard: {
      id: artboardId,
      name: naming.artboardName,
      width: dimensions.width,
      height: dimensions.height,
      source: {
        tool: "svg",
        id: file.path,
        name: naming.originalName,
        width: dimensions.width,
        height: dimensions.height,
      },
      // Both are optional in the IR and both are absent for an unannotated
      // filename; assigning `undefined` would put an enumerable key on the
      // artboard that JSON.stringify drops.
      ...(naming.responsiveness === undefined ? {} : { responsiveness: naming.responsiveness }),
      ...(naming.imageOnly === undefined ? {} : { imageOnly: naming.imageOnly }),
      layers,
    },
    backgroundAsset,
    backgroundFile,
    imageAltText,
  };
}

function deriveSlug(entrypointPaths: readonly string[], options: ImportOptions): string {
  if (options.slug) return makeKeyword(options.slug) || options.slug;
  if (entrypointPaths.length === 1) {
    return makeKeyword(stripExtension(entrypointPaths[0]) || "svg-import");
  }
  const stems = entrypointPaths.map((path) => parseFileName(stripExtension(path)).artboardName);
  const unique = Array.from(new Set(stems));
  if (unique.length === 1) return makeKeyword(unique[0]) || unique[0];
  return "svg-import";
}

function validateGrouping(artboards: readonly Artboard[]): void {
  const byName = new Map<string, Artboard[]>();
  for (const artboard of artboards) {
    const bucket = byName.get(artboard.name);
    if (bucket) bucket.push(artboard);
    else byName.set(artboard.name, [artboard]);
  }

  for (const [name, bucket] of byName.entries()) {
    if (bucket.length < 2) continue;
    const widths = new Set<number>();
    for (const artboard of bucket) {
      const roundedWidth = Math.round(artboard.width * 1000);
      if (widths.has(roundedWidth)) {
        throw new Error(`Responsive SVG variants for "${name}" must have unique widths.`);
      }
      widths.add(roundedWidth);
    }
  }
}

export async function importSVGFilesWithRasterizer(
  files: readonly ImportedFile[],
  options: SVGImportOptions & { rasterizer: SvgRasterizer },
): Promise<ImportResult> {
  const rasterizer = options.rasterizer;
  const filesByPath = new Map<string, ImportedFile>();
  for (const file of files) {
    filesByPath.set(normalizeImportPath(file.path), {
      ...file,
      path: normalizeImportPath(file.path),
    });
  }

  const entrypointPaths = (
    options.entrypointPaths?.map(normalizeImportPath) ??
    Array.from(filesByPath.keys()).filter((path) => path.toLowerCase().endsWith(".svg"))
  ).sort((a, b) => a.localeCompare(b));

  if (entrypointPaths.length === 0) {
    throw new Error("No SVG files were provided for import.");
  }

  const state: ImportState = {
    warnings: [],
    warningMessages: new Set<string>(),
    fonts: new Map<string, FontMapping>(),
    assetFiles: [],
    writtenAssetPaths: new Set<string>(),
    extractedRefs: new Map<string, string>(),
  };

  const assets: Record<string, Asset> = {};
  const artboards: Artboard[] = [];
  let imageAltText: string | undefined;
  const importSettings: Settings = {
    ...defaultSettings,
    ...(options.settings ?? {}),
  };

  for (const entrypointPath of entrypointPaths) {
    const file = filesByPath.get(entrypointPath);
    if (!file) {
      throw new Error(`Missing SVG entrypoint: ${entrypointPath}`);
    }

    const naming = parseFileName(stripExtension(entrypointPath));
    if (naming.ambiguousBase) {
      addWarning(
        state,
        "import:ambiguous-filename",
        "other",
        `${entrypointPath}: treated "${naming.originalName}" as a standalone artboard because its suffix is not recognized.`,
      );
    }

    const parsed = await parseSvgFile(state, file, filesByPath, naming, importSettings, rasterizer);
    artboards.push(parsed.artboard);
    imageAltText ??= parsed.imageAltText;
    if (parsed.backgroundAsset && parsed.backgroundFile) {
      assets[parsed.backgroundAsset.id] = parsed.backgroundAsset;
      state.assetFiles.push(parsed.backgroundFile);
    }
  }

  if (artboards.length === 0) {
    throw new Error("SVG import produced zero artboards.");
  }

  validateGrouping(artboards);

  const distinctGroups = new Set(artboards.map((artboard) => artboard.name)).size;
  const outputMode = distinctGroups > 1 ? "multiple-files" : "one-file";

  const slug = deriveSlug(entrypointPaths, options);
  const document: Document = {
    irVersion: CURRENT_IR_VERSION,
    source: {
      tool: "svg",
      toolVersion: "1.0",
      adapterVersion: "0.1.0",
    },
    settings: {
      ...importSettings,
      projectName: slug,
      output: options.settings?.output ?? outputMode,
    },
    fonts: Array.from(state.fonts.values()),
    artboards,
    customBlocks: [],
    assets,
    metadata: {
      slug,
      ...(imageAltText ? { imageAltText } : {}),
    },
  };

  const sortedWarnings = state.warnings.slice().sort((a, b) => a.message.localeCompare(b.message));

  return {
    document,
    assetFiles: state.assetFiles,
    warnings: sortedWarnings.map((warning) => warning.message),
    structuredWarnings: sortedWarnings,
  };
}

export interface SVGImportOptions extends ImportOptions {
  rasterizer: SvgRasterizer;
}
