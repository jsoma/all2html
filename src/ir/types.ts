// === Base IR Types (as produced by importers/exporters) ===

export const CURRENT_IR_VERSION = "0.1.0";

export interface Document {
  /** IR schema version. Big-bang pre-release revisions do not guarantee compatibility. */
  irVersion: string;
  source: SourceMetadata;
  settings: Partial<Settings>;
  fonts: FontMapping[];
  artboards: Artboard[];
  customBlocks: CustomBlock[];
  assets: Record<string, Asset>;
  metadata: Metadata;
  /**
   * Type-level marker only — never present at runtime and never serialized.
   *
   * The pipeline phase documents (`ResolvedDocument` and friends) carry a
   * `pipelinePhase` literal. Declaring the source document's slot as `never`
   * is what stops a *later* phase from being handed back to a transform that
   * consumes the source document, which structural typing would otherwise
   * allow (SPEC §12.1, decision D20). It costs zero runtime bytes and is
   * absent from `DocumentSchema`, so the persisted IR is unaffected.
   */
  pipelinePhase?: never;
}

/** JSON-serializable value for arbitrary metadata fields. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SourceMetadata {
  /** Source tool or adapter name, e.g. "illustrator", "figma", "svg". */
  tool: string;
  /** Version of the source tool when available. */
  toolVersion?: string;
  /** Version of the all2html adapter/exporter that produced this IR. */
  adapterVersion?: string;
  /** Source-native document/node identifier when available. */
  id?: string;
  /** Source-native display name when available. */
  name?: string;
  /** Arbitrary JSON-serializable source metadata. */
  [key: string]: JsonValue | undefined;
}

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
  googleFonts: "none" | "import" | "link";
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

/*
 * `Artboard.relationship` ("alternates" | "sequence", SPEC §12.10.5) was declared
 * and validated here and consumed by nothing. Removed under D16 — dead code gets a
 * test pinning its intended caller or a deletion naming its replacement; a
 * round-trip test is neither. Its replacement is `groupArtboards`, which is where
 * the alternates/sequence distinction has to act. That module is ES3-safe now and
 * every surface runs it, so the D19 blocker is gone — what is still missing is the
 * behavior: "all of them, in order" (sequence) versus "pick one by width"
 * (alternates) is a `computeBreakpoints`/emitter distinction, not a grouping one,
 * and D27 does not specify it. The field returns with that behavior, not before.
 */

export interface Artboard {
  /** Stable canonical ID used by assets, grouping, and diagnostics. */
  id: string;
  name: string;
  width: number;
  height: number;
  source?: SourceMetadata;
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
  /** Stable canonical ID used by assets and host diagnostics. */
  id: string;
  name: string;
  type: LayerType;
  source?: SourceMetadata;
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

interface TextElementFields {
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
  /** Why the exporter chose this renderAs value. Allows core to override if needed. */
  renderAsReason?: "rotation" | "warp" | "pathText" | "imageOnly" | "setting";
  dataAttributes?: Record<string, string>;
  binding?: {
    path: string;
    allowHtml: boolean;
  };
}

/**
 * Text the core renders as live HTML. Only this variant is ever styled, class-assigned
 * and positioned, so it is the only one that gains `computed*` fields downstream.
 */
export interface HtmlTextElement extends TextElementFields {
  renderAs: "html";
}

/**
 * Text baked into the artboard's background image by the exporter. It stays in the
 * document as a record of what was rasterized, but no transform touches it.
 *
 * Modelling it as its own variant (discriminated by `renderAs`, which already exists
 * in the persisted IR — no schema change) is what removes the cast at the top of
 * `computeStyles`: the "not styled" branch has a name instead of an assertion
 * (SPEC §12.1, decision D20).
 */
export interface ImageTextElement extends TextElementFields {
  renderAs: "image";
}

export type TextElement = HtmlTextElement | ImageTextElement;

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
  sourceFont: string;
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
  artboardId: string;
  layerId?: string;
  source?: SourceMetadata;
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

/**
 * Visibility / sizing bounds for one artboard.
 *
 * Absence is modelled by absence: an omitted `maxWidth` / `widthRangeMax` means
 * "unbounded above". No sentinel value (`Infinity`, `-1`, `99999`) is ever stored,
 * because the document model must survive a JSON round-trip unchanged and
 * `JSON.stringify(Infinity)` silently becomes `null`.
 */
export interface ArtboardBreakpoint {
  minWidth: number;
  /** Omitted when unbounded above. */
  maxWidth?: number;
  widthRangeMin: number;
  /** Omitted when unbounded above. */
  widthRangeMax?: number;
}

/**
 * The names of the pipeline's intermediate documents, in order.
 *
 * Phase documents are **internal**. The persisted canonical IR is always the
 * validated source `Document` — `output-bundle.ts` serializes that, never one of
 * these — so adding a phase here does not widen the public contract (D20).
 */
export type PipelinePhase =
  | "resolved"
  | "breakpointed"
  | "styled"
  | "deduplicated"
  | "emitterReady";

interface PhaseArtboards {
  resolved: ResolvedArtboard;
  breakpointed: BreakpointedArtboard;
  styled: StyledArtboard;
  deduplicated: DeduplicatedArtboard;
  emitterReady: EmitterReadyArtboard;
}

/**
 * A document at one named phase of the pipeline.
 *
 * The phase name is carried as an explicit literal rather than being implied by
 * which extra fields happen to be present. TypeScript is structural, so additive
 * phase fields do **not** stop a later document from satisfying an earlier phase's
 * parameter — which is exactly why `computeBreakpoints` used to accept and return
 * the same type and could be called twice, or skipped, with no type error
 * (SPEC §12.1, decision D20). With the literal, every pair of phases is mutually
 * unassignable, so each transform's signature names precisely what it consumes and
 * what it produces.
 */
export interface PhaseDocument<P extends PipelinePhase>
  extends Omit<Document, "settings" | "artboards" | "pipelinePhase"> {
  pipelinePhase: P;
  settings: Settings;
  artboards: PhaseArtboards[P][];
}

/** Settings merged and complete. Breakpoints do not exist yet — by construction. */
export type ResolvedDocument = PhaseDocument<"resolved">;
/** Visibility/sizing ranges assigned. */
export type BreakpointedDocument = PhaseDocument<"breakpointed">;
/** Text converted to CSS declarations. */
export type StyledDocument = PhaseDocument<"styled">;
/** Style classes extracted and assigned. */
export type DeduplicatedDocument = PhaseDocument<"deduplicated">;
/** Positions computed. Every element carries its final computed geometry. */
export type EmitterReadyDocument = PhaseDocument<"emitterReady">;

/**
 * Post-`resolveSettings` artboard. Deliberately identical to `Artboard`: the whole
 * point of the `breakpointed` phase is that `breakpoint` is *absent* here, so the
 * placeholder `{ minWidth: 0, widthRangeMin: 0 }` that `settings-resolver.ts` used
 * to fabricate purely to satisfy the type has no reason to exist.
 */
export type ResolvedArtboard = Artboard;

export interface BreakpointedArtboard extends Artboard {
  breakpoint: ArtboardBreakpoint;
}

export interface StyledTextElement extends HtmlTextElement {
  computedParagraphStyles: ComputedTextStyle[];
  computedRunStyles: ComputedTextStyle[][];
}

export type StyledElement =
  | StyledTextElement
  | ImageTextElement
  | ShapeElement
  | VideoElement
  | RawHtmlElement
  | SnippetElement;

export interface StyledLayer extends Omit<Layer, "elements"> {
  elements: StyledElement[];
}

export interface StyledArtboard extends Omit<BreakpointedArtboard, "layers"> {
  layers: StyledLayer[];
}

export interface DeduplicatedTextElement extends StyledTextElement {
  paragraphClassNames: (string | null)[];
  runClassNames: (string | null)[][];
  effectClassName: string | null;
}

export type DeduplicatedElement =
  | DeduplicatedTextElement
  | ImageTextElement
  | ShapeElement
  | VideoElement
  | RawHtmlElement
  | SnippetElement;

export interface DeduplicatedLayer extends Omit<Layer, "elements"> {
  elements: DeduplicatedElement[];
}

export interface EffectStyleEntry {
  key: string;
  className: string;
  css: string;
}

export interface DeduplicatedArtboard extends Omit<StyledArtboard, "layers"> {
  baseParagraphStyle: ComputedTextStyle;
  paragraphStyleClasses: StyleClassEntry[];
  characterStyleClasses: StyleClassEntry[];
  effectStyleClasses: EffectStyleEntry[];
  layers: DeduplicatedLayer[];
}

/**
 * `computePositions` is what turns a `DeduplicatedTextElement` into this. Splitting
 * the two is what removes `deduplicateStyles`' placeholder `computedPosition:
 * { width: "" }`, which existed only because the emitter-ready shape was demanded
 * one phase before positions were computed.
 */
export interface EmitterReadyTextElement extends DeduplicatedTextElement {
  computedPosition: ComputedPosition;
}

export interface EmitterReadyArtboard extends Omit<DeduplicatedArtboard, "layers"> {
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

/**
 * The raw `ShapeElement` / `SnippetElement` variants are deliberately absent: every
 * shape and snippet has been through `computePositions` by this point, so admitting
 * the un-positioned variants here would make "emitter-ready" mean nothing and force
 * the emitters back into `"computedShapePosition" in el` probes.
 */
export type EmitterReadyElement =
  | EmitterReadyTextElement
  | ImageTextElement
  | EmitterReadyShapeElement
  | EmitterReadySnippetElement
  | VideoElement
  | RawHtmlElement;

export interface EmitterReadyLayer extends Omit<Layer, "elements"> {
  elements: EmitterReadyElement[];
}
