// === Base IR Types (as produced by the exporter) ===

export interface Document {
  /** IR schema version. Use "0.0.0" for pre-release. */
  irVersion: string;
  generator: {
    tool: string;
    toolVersion: string;
    pluginVersion: string;
  };
  settings: Partial<Settings>;
  fonts: FontMapping[];
  artboards: Artboard[];
  customBlocks: CustomBlock[];
  assets: Record<string, Asset>;
  metadata: Metadata;
}

/** JSON-serializable value for arbitrary metadata fields. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Metadata {
  slug: string;
  /** BCP 47 language tag (e.g., "en", "ja", "ar"). Used for HTML lang attribute. */
  lang?: string;
  headline?: string;
  leadin?: string;
  summary?: string;
  notes?: string;
  sources?: string;
  credit?: string;
  altText?: string;
  imageAltText?: string;
  ariaRole?: string;
  /** Arbitrary passthrough metadata. The core pipeline never reads these keys. */
  [key: string]: JsonValue | undefined;
}

export interface Settings {
  imageFormat: ImageFormat[];
  writeImageFiles: boolean;
  pngTransparent: boolean;
  pngNumberOfColors: number;
  jpgQuality: number;
  use2xImages: boolean;
  cacheBustToken: number | null;
  namespace: string;
  projectName: string;
  output: "one-file" | "multiple-files";
  htmlOutputPath: string;
  htmlOutputExtension: string;
  imageOutputPath: string;
  imageSourcePath: string;
  responsiveness: Responsiveness;
  textResponsiveness: "fixed" | "dynamic";
  maxWidth: number | null;
  centerHtmlOutput: boolean;
  renderTextAs: "html" | "image";
  renderRotatedSkewedTextAs: "html" | "image";
  testingMode: boolean;
  includeResizerCss: boolean;
  includeResizerWidths: boolean;
  responsiveImageMode: "img-src" | "css-var";
  useLazyLoader: boolean;
  inlineSvg: boolean;
  svgIdPrefix: string;
  svgEmbedImages: boolean;
  clickableLink: string;
  createPromoImage: boolean;
  promoImageWidth: number;
  localPreviewTemplate: string;
}

export type ImageFormat = "auto" | "png" | "png24" | "jpg" | "svg";
export type Responsiveness = "fixed" | "dynamic";

export interface Artboard {
  name: string;
  originalName: string;
  width: number;
  height: number;
  actualWidth: number;
  actualHeight: number;
  responsiveness?: Responsiveness;
  imageOnly?: boolean;
  layers: Layer[];
}

export type LayerType =
  | "default"
  | "svg"
  | "png"
  | "symbol"
  | "div"
  | "video"
  | "html-before"
  | "html-after";

export interface Layer {
  name: string;
  type: LayerType;
  inlineSvg: boolean;
  visible: boolean;
  opacity: number;
  elements: Element[];
}

export type Element = TextElement | ShapeElement | VideoElement | RawHtmlElement | SnippetElement;

export interface DropShadowEffect {
  type: "dropShadow";
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  color: Color;
}

export interface BlurEffect {
  type: "blur";
  radius: number;
}

export type TextEffect = DropShadowEffect | BlurEffect;

export interface TextElement {
  type: "text";
  id: string;
  kind: "point" | "area";
  position: BoundingBox;
  rotation?: number;
  transformMatrix?: number[];
  /** 0-100 scale (0 = fully transparent, 100 = fully opaque). */
  opacity: number;
  blendMode?: "multiply";
  valign: "top" | "middle" | "bottom";
  paragraphs: Paragraph[];
  effects?: TextEffect[];
  areaFill?: Color;
  areaBorder?: { width: number; color: Color };
  renderAs: "html" | "image";
  /** Why the exporter chose this renderAs value. Allows core to override if needed. */
  renderAsReason?: "rotation" | "warp" | "pathText" | "imageOnly" | "setting";
  dataAttributes?: Record<string, string>;
  binding?: {
    path: string;
    allowHtml: boolean;
  };
}

export interface ShapeElement {
  type: "shape";
  shapeType: "rectangle" | "circle" | "line";
  id?: string;
  position: BoundingBox;
  fill?: Color;
  stroke?: { width: number; color: Color };
  opacity: number;
  blendMode?: "multiply";
  orientation?: "horizontal" | "vertical";
  segments?: { x1: number; y1: number; x2: number; y2: number }[];
}

export interface VideoElement {
  type: "video";
  url: string;
}

export interface RawHtmlElement {
  type: "rawHtml";
  content: string;
}

export interface SnippetElement {
  type: "snippet";
  key: string;
  group?: string;
  position: BoundingBox;
  geometry?: { kind: "rectangle" | "circle" | "line" };
  visible?: boolean;
}

export interface Paragraph {
  text: string;
  alignment: "left" | "center" | "right" | "justify";
  /** Text direction. Defaults to "ltr" if omitted. */
  direction?: "ltr" | "rtl";
  leading: number;
  spaceBefore: number;
  spaceAfter: number;
  runs: CharacterRun[];
}

export interface CharacterRun {
  text: string;
  fontName: string;
  fontPostScriptName?: string;
  fontSize: number;
  color: Color;
  /** Letter-spacing in em units. Maps directly to CSS letter-spacing.
   *  Exporters must convert from tool-native units (e.g., AI tracking / 1000). */
  letterSpacing: number;
  capitalization: "normal" | "allcaps" | "smallcaps";
  baselineShift: "normal" | "superscript" | "subscript";
  hyperlink?: { href: string; target?: string };
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  /** 0-100 scale (0 = fully transparent, 100 = fully opaque). Omit for fully opaque. */
  opacity?: number;
}

export interface FontMapping {
  aifont: string;
  family: string;
  weight?: string;
  style?: string;
  vshift?: string;
}

export interface CustomBlock {
  type: "css" | "js" | "html" | "html-before" | "html-after";
  content: string;
}

export interface Asset {
  id: string;
  path: string;
  hash?: string;
  mimeType: string;
  width: number;
  height: number;
  artboardName: string;
  layerName?: string;
  exportParams: {
    format: string;
    scale: number;
    transparent?: boolean;
    quality?: number;
    colors?: number;
  };
}

// === Computed Style Types ===

export interface ComputedTextStyle {
  [key: string]: string | undefined;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  color?: string;
  lineHeight?: string;
  height?: string;
  letterSpacing?: string;
  opacity?: string;
  paddingTop?: string;
  paddingBottom?: string;
  textAlign?: string;
  textTransform?: string;
  mixBlendMode?: string;
  verticalAlign?: string;
  position?: string;
  top?: string;
}

export interface ComputedPosition {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  marginTop?: string;
  marginLeft?: string;
  width: string;
  transform?: string;
  transformOrigin?: string;
}

export interface StyleClassEntry {
  key: string;
  className: string;
  style: ComputedTextStyle;
}

// === Pipeline Phase Types ===

export interface ArtboardBreakpoint {
  minWidth: number;
  maxWidth: number;
  widthRangeMin: number;
  widthRangeMax: number;
}

export interface ResolvedDocument extends Omit<Document, "settings" | "artboards"> {
  settings: Settings;
  artboards: ResolvedArtboard[];
}

export interface ResolvedArtboard extends Artboard {
  breakpoint: ArtboardBreakpoint;
}

export interface StyledTextElement extends TextElement {
  computedParagraphStyles: ComputedTextStyle[];
  computedRunStyles: ComputedTextStyle[][];
}

export interface StyledArtboard extends ResolvedArtboard {
  layers: StyledLayer[];
}

export interface StyledLayer extends Layer {
  elements: (StyledTextElement | ShapeElement | VideoElement | RawHtmlElement | SnippetElement)[];
}

export interface StyledDocument extends Omit<ResolvedDocument, "artboards"> {
  artboards: StyledArtboard[];
}

export interface EmitterReadyTextElement extends StyledTextElement {
  paragraphClassNames: (string | null)[];
  runClassNames: (string | null)[][];
  effectClassName: string | null;
  computedPosition: ComputedPosition;
}

export interface EffectStyleEntry {
  key: string;
  className: string;
  css: string;
}

export interface EmitterReadyArtboard extends Omit<StyledArtboard, "layers"> {
  baseParagraphStyle: ComputedTextStyle;
  paragraphStyleClasses: StyleClassEntry[];
  characterStyleClasses: StyleClassEntry[];
  effectStyleClasses: EffectStyleEntry[];
  layers: EmitterReadyLayer[];
}

export interface ComputedShapePosition {
  left: string;
  top: string;
  marginLeft: string;
  marginTop: string;
  width: string;
  height: string;
  borderRadius?: string;
  backgroundColor?: string;
  border?: string;
  borderTop?: string;
  borderRight?: string;
  opacity?: string;
  mixBlendMode?: string;
}

export interface EmitterReadyShapeElement extends ShapeElement {
  computedShapePosition: ComputedShapePosition;
}

export interface EmitterReadySnippetElement extends SnippetElement {
  computedPosition: ComputedPosition;
}

export interface EmitterReadyLayer extends Layer {
  elements: (
    | EmitterReadyTextElement
    | EmitterReadyShapeElement
    | EmitterReadySnippetElement
    | ShapeElement
    | VideoElement
    | RawHtmlElement
    | SnippetElement
  )[];
}

export interface EmitterReadyDocument extends Omit<StyledDocument, "artboards"> {
  artboards: EmitterReadyArtboard[];
}
