/**
 * Shared types between the CEP panel UI and ExtendScript hostscript.
 * These define the JSON payloads that cross the evalTS bridge.
 */

import { getSettingDefault } from "../../../../../src/ir/settings-definitions.js";

/** Settings as the panel UI understands them. camelCase, all optional (sparse). */
export interface PanelSettings {
  // Essential
  output?: "one-file" | "multiple-files";
  imageFormat?: "auto" | "png" | "png24" | "jpg" | "svg";
  jpgQuality?: number;
  pngNumberOfColors?: number;
  use2xImages?: boolean;
  responsiveness?: "fixed" | "dynamic";
  renderTextAs?: "html" | "image";
  htmlOutputPath?: string;
  imageOutputPath?: string;

  // Advanced - output
  namespace?: string;
  projectName?: string;
  htmlOutputExtension?: string;
  imageSourcePath?: string;
  writeImageFiles?: boolean;

  // Advanced - responsive
  textResponsiveness?: "fixed" | "dynamic";
  maxWidth?: number | null;
  centerHtmlOutput?: boolean;

  // Advanced - rendering
  renderRotatedSkewedTextAs?: "html" | "image";
  googleFonts?: "none" | "import" | "link";
  testingMode?: boolean;

  // Advanced - CSS/features
  includeResizerCss?: boolean;
  includeResizerWidths?: boolean;
  inlineSvg?: boolean;
  svgIdPrefix?: string;
  svgEmbedImages?: boolean;

  // Advanced - image
  pngTransparent?: boolean;
  cacheBustToken?: number | null;

  // Advanced - accessibility
  clickableLink?: string;
  altText?: string;
  ariaRole?: string;
}

export type PanelSettingKey = keyof PanelSettings;

export type SettingSource =
  | "text-block"
  | "document-xmp"
  | "config-file"
  | "app-defaults"
  | "core-defaults";

/** Font mapping entry used by CEP panels across hosts. */
export interface FontEntry {
  /**
   * Host-native source font name shown in the design tool.
   * This is the canonical panel-side key.
   */
  sourceFont?: string;
  /**
   * Legacy Illustrator compatibility alias.
   * Keep it only at panel/host boundaries for older saved panel state.
   */
  aifont?: string;
  family: string;
  weight?: string;
  style?: string;
  vshift?: string;
}

export function getFontSourceName(font: FontEntry): string {
  return font.sourceFont || font.aifont || "";
}

export function createFontEntry(
  sourceFont: string,
  overrides: Partial<Omit<FontEntry, "sourceFont" | "aifont">> = {},
): FontEntry {
  return {
    sourceFont,
    aifont: sourceFont,
    family: "",
    ...overrides,
  };
}

export function normalizeFontEntry(font: FontEntry): FontEntry {
  const sourceFont = getFontSourceName(font);
  return {
    ...font,
    sourceFont,
    aifont: font.aifont || sourceFont,
  };
}

/** Grouped warnings returned by the exporter in automated mode. */
export interface GroupedWarnings {
  fonts: string[];
  masks: string[];
  rotation: string[];
  overset: string[];
  settings: string[];
  other: string[];
}

export interface DiagnosticEntry {
  scope: "panel" | "host" | "illustrator-exporter" | "ae-exporter";
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
  timestamp?: string;
}

export interface DiagnosticsPayload {
  entries: DiagnosticEntry[];
  lastError?: string;
}

/** Result returned by runExport(). Matches exporter.jsx automated output. */
export interface RunResult {
  success: boolean;
  outputPath?: string;
  slug?: string;
  artboardCount?: number;
  imageCount?: number;
  elapsed?: string;
  warnings?: GroupedWarnings;
  error?: string;
  diagnostics?: DiagnosticsPayload;
}

/** Info about the currently active Illustrator document. */
export interface DocumentInfo {
  name: string;
  /** Empty when the active document has not been saved yet. */
  path: string;
  saved: boolean;
  artboardCount: number;
  /**
   * Fingerprint of the current ai2html-settings text block contents.
   * Changes when the block is added, removed, or edited inside the same document.
   */
  settingsBlockSignature?: string | null;
}

export interface AeCompInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  duration: number;
  frameRate: number;
}

export interface AeProjectInfo {
  name: string;
  path: string;
  saved: boolean;
  compCount: number;
  activeCompId: string | null;
  activeCompName: string | null;
}

export interface AePanelSettings {
  overlayPrefix?: string;
  targetCompId?: string | null;
  outputRoot?: string;
  videoTemplate?: string;
  posterTemplate?: string;
  googleFonts?: "none" | "import" | "link";
}

export interface AeConfigData {
  version: string;
  settings: AePanelSettings;
  fonts: FontEntry[];
}

export interface AeTemplateCatalog {
  outputModuleTemplates: string[];
  canQueueInAME?: boolean;
}

export interface AeRunResult {
  success: boolean;
  outputPath?: string;
  slug?: string;
  overlayCount?: number;
  elapsed?: string;
  compName?: string;
  videoMode?: string;
  videoRendered?: boolean;
  videoTemplate?: string | null;
  posterTemplate?: string | null;
  posterRendered?: boolean;
  posterPath?: string | null;
  posterError?: string | null;
  summaryPath?: string;
  htmlPath?: string;
  jsonPath?: string;
  videoPath?: string;
  error?: string;
  diagnostics?: DiagnosticsPayload;
}

/** XMP-stored data envelope. Schema-versioned from day one. */
export interface XmpData {
  version: string;
  settings: PanelSettings;
  fonts: FontEntry[];
  lastSaved?: string;
}

/** Default values for all panel settings. Mirrors src/ir/defaults.ts. */
export const panelDefaults: Required<
  Pick<
    PanelSettings,
    | "output"
    | "imageFormat"
    | "jpgQuality"
    | "pngNumberOfColors"
    | "use2xImages"
    | "responsiveness"
    | "renderTextAs"
    | "htmlOutputPath"
    | "imageOutputPath"
    | "namespace"
    | "projectName"
    | "htmlOutputExtension"
    | "imageSourcePath"
    | "writeImageFiles"
    | "textResponsiveness"
    | "centerHtmlOutput"
    | "renderRotatedSkewedTextAs"
    | "googleFonts"
    | "testingMode"
    | "includeResizerCss"
    | "includeResizerWidths"
    | "inlineSvg"
    | "svgIdPrefix"
    | "svgEmbedImages"
    | "pngTransparent"
  >
> = {
  output: getSettingDefault("output"),
  imageFormat: getSettingDefault("imageFormat")[0] ?? "auto",
  jpgQuality: getSettingDefault("jpgQuality"),
  pngNumberOfColors: getSettingDefault("pngNumberOfColors"),
  use2xImages: getSettingDefault("use2xImages"),
  responsiveness: getSettingDefault("responsiveness"),
  renderTextAs: getSettingDefault("renderTextAs"),
  htmlOutputPath: getSettingDefault("htmlOutputPath"),
  imageOutputPath: getSettingDefault("imageOutputPath"),
  namespace: getSettingDefault("namespace"),
  projectName: getSettingDefault("projectName"),
  htmlOutputExtension: getSettingDefault("htmlOutputExtension"),
  imageSourcePath: getSettingDefault("imageSourcePath"),
  writeImageFiles: getSettingDefault("writeImageFiles"),
  textResponsiveness: getSettingDefault("textResponsiveness"),
  centerHtmlOutput: getSettingDefault("centerHtmlOutput"),
  renderRotatedSkewedTextAs: getSettingDefault("renderRotatedSkewedTextAs"),
  googleFonts: getSettingDefault("googleFonts"),
  testingMode: getSettingDefault("testingMode"),
  includeResizerCss: getSettingDefault("includeResizerCss"),
  includeResizerWidths: getSettingDefault("includeResizerWidths"),
  inlineSvg: getSettingDefault("inlineSvg"),
  svgIdPrefix: getSettingDefault("svgIdPrefix"),
  svgEmbedImages: getSettingDefault("svgEmbedImages"),
  pngTransparent: getSettingDefault("pngTransparent"),
};
