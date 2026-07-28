import type { EmitterConfig } from "../../../src/emitters/types.js";
import type {
  Asset,
  CustomBlock,
  Element,
  FontMapping,
  ImageFormat,
  JsonValue,
  LayerType,
  Metadata,
  Paragraph,
  Responsiveness,
  Settings,
  TextElement,
} from "../../../src/ir/types.js";

export interface SelectionParentLike {
  type: string;
}

export interface SelectionNodeLike {
  id: string;
  type: string;
  name: string;
  width?: number;
  height?: number;
  parent?: SelectionParentLike | null;
}

export interface FrameSelectionNodeLike extends SelectionNodeLike {
  type: "FRAME";
  width: number;
  height: number;
}

export interface FrameInfo {
  sourceNodeId: string;
  name: string;
  originalName: string;
  width: number;
  height: number;
  widthOverride?: number;
  responsiveness?: "fixed" | "dynamic";
  imageOnly?: boolean;
}

export interface FrameGroup {
  name: string;
  frames: FrameInfo[];
}

export interface ExtractedTextElement extends Omit<TextElement, "paragraphs"> {
  sourceNodeId: string;
  paragraphs: Paragraph[];
}

export interface ExtractedLayer {
  sourceNodeId: string;
  name: string;
  type: LayerType;
  inlineSvg: boolean;
  visible: boolean;
  opacity: number;
  elements: Element[];
}

export interface ExtractedAsset extends Asset {
  sourceNodeId?: string;
  bytes?: Uint8Array;
}

export interface ExtractedFrame extends FrameInfo {
  actualWidth: number;
  actualHeight: number;
  layers: ExtractedLayer[];
  fonts?: FontMapping[];
  assets?: ExtractedAsset[];
  metadata?: Record<string, JsonValue>;
}

export interface FigmaPluginConfig {
  settings?: Partial<Settings>;
  metadata?: Partial<Metadata>;
  fonts?: FontMapping[];
  customBlocks?: CustomBlock[];
  /**
   * Canonical emitter options, the same `emit` block the CLI reads out of
   * `all2html.config.json` (`EmitterConfigSchema` in `src/emitters/types.ts`).
   * Not a Figma-only contract — it is the one seam through which shipped
   * emitter behavior (`positionMode`, `allowUnsafeHtml`, `responsiveImageMode`)
   * is reachable at all.
   */
  emit?: EmitterConfig;
}

export type FigmaOutputFormat = "html" | "standalone";
export type FigmaPresetId = "standard-story" | "responsive-story" | "image-only-graphic" | "custom";

export type SelectionExportKind = "empty" | "single" | "responsive" | "mixed";

export interface SelectionGroupSummary {
  name: string;
  frameCount: number;
  frameNames: string[];
  widths: number[];
  mode: "single" | "responsive";
}

export interface SelectionSummary {
  totalSelected: number;
  eligibleFrames: number;
  frameNames: string[];
  groupNames: string[];
  groups: SelectionGroupSummary[];
  exportKind: SelectionExportKind;
  error?: string;
}

export interface FigmaLocalUiState {
  format: FigmaOutputFormat;
  advancedOpen: boolean;
  moreSettingsOpen: boolean;
  preset: FigmaPresetId;
}

export interface FigmaDirectControls {
  projectName: string;
  output: "one-file" | "multiple-files";
  headline: string;
  altText: string;
  imageAltText: string;
  ariaRole: string;
  responsiveness: Responsiveness;
  imageFormat: ImageFormat;
  centerHtmlOutput: boolean;
  renderTextAs: "html" | "image";
  renderRotatedSkewedTextAs: "html" | "image";
  googleFonts: Settings["googleFonts"];
  responsiveImageMode: "img-src" | "css-var";
}

export type UiToSandboxMessage =
  | { type: "get-selection-summary" }
  | { type: "load-config" }
  | { type: "save-local-ui-state"; localState: FigmaLocalUiState }
  | { type: "save-config"; configText: string }
  | { type: "export"; configText: string; format: FigmaOutputFormat };

export type SandboxToUiMessage =
  | { type: "selection-summary"; selection: SelectionSummary }
  | { type: "config-loaded"; configText: string; localState: FigmaLocalUiState }
  | { type: "config-saved"; configText: string }
  | {
      type: "export-success";
      format: FigmaOutputFormat;
      fileCount: number;
      files: string[];
      warningCount: number;
      warnings: string[];
      zipFilename: string;
      zipBytes: Uint8Array;
    }
  | {
      type: "export-error";
      message: string;
      details?: string[];
    };
