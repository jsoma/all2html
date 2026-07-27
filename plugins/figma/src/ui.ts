import { defaultSettings } from "../../../src/ir/defaults.js";
import { parsePluginConfig } from "./config.js";
import type {
  FigmaDirectControls,
  FigmaLocalUiState,
  FigmaOutputFormat,
  FigmaPluginConfig,
  FigmaPresetId,
  SelectionSummary,
} from "./types.js";

export interface FigmaUiState {
  configText: string;
  parsedConfig: FigmaPluginConfig;
  configError: string | null;
  format: FigmaOutputFormat;
  advancedOpen: boolean;
  moreSettingsOpen: boolean;
  preset: FigmaPresetId;
  selection: SelectionSummary;
  warnings: string[];
  exportSummary: ExportResultSummary | null;
  exporting: boolean;
}

export interface ExportResultSummary {
  format: FigmaOutputFormat;
  fileCount: number;
  files: string[];
  warningCount: number;
  zipFilename: string;
}

export function createEmptySelectionSummary(): SelectionSummary {
  return {
    totalSelected: 0,
    eligibleFrames: 0,
    frameNames: [],
    groupNames: [],
    groups: [],
    exportKind: "empty",
  };
}

export function createInitialDirectControls(): FigmaDirectControls {
  return {
    projectName: defaultSettings.projectName,
    output: defaultSettings.output,
    headline: "",
    altText: "",
    imageAltText: "",
    ariaRole: "",
    responsiveness: defaultSettings.responsiveness,
    imageFormat: defaultSettings.imageFormat[0] ?? "auto",
    centerHtmlOutput: defaultSettings.centerHtmlOutput,
    renderTextAs: defaultSettings.renderTextAs,
    renderRotatedSkewedTextAs: defaultSettings.renderRotatedSkewedTextAs,
    googleFonts: defaultSettings.googleFonts,
    responsiveImageMode: defaultSettings.responsiveImageMode,
  };
}

export const presetLabels: Record<FigmaPresetId, string> = {
  "standard-story": "Standard story",
  "responsive-story": "Responsive story",
  "image-only-graphic": "Image-only graphic",
  custom: "Custom",
};

export function createInitialUiState(selection: SelectionSummary): FigmaUiState {
  return {
    configText: "",
    parsedConfig: {},
    configError: null,
    format: "html",
    advancedOpen: false,
    moreSettingsOpen: false,
    preset: "standard-story",
    selection,
    warnings: [],
    exportSummary: null,
    exporting: false,
  };
}

function cloneConfig(config: FigmaPluginConfig): FigmaPluginConfig {
  return {
    settings: config.settings ? { ...config.settings } : undefined,
    metadata: config.metadata ? { ...config.metadata } : undefined,
    fonts: config.fonts ? [...config.fonts] : undefined,
    customBlocks: config.customBlocks ? [...config.customBlocks] : undefined,
  };
}

function cleanupConfig(config: FigmaPluginConfig): FigmaPluginConfig {
  const cleaned = cloneConfig(config);

  if (cleaned.settings && Object.keys(cleaned.settings).length === 0) {
    delete cleaned.settings;
  }
  if (cleaned.metadata && Object.keys(cleaned.metadata).length === 0) {
    delete cleaned.metadata;
  }
  if (cleaned.fonts && cleaned.fonts.length === 0) {
    delete cleaned.fonts;
  }
  if (cleaned.customBlocks && cleaned.customBlocks.length === 0) {
    delete cleaned.customBlocks;
  }

  return cleaned;
}

function setOptionalString(
  record: Record<string, unknown>,
  key: string,
  value: string,
  defaultValue = "",
): void {
  const normalized = value.trim();
  if (normalized === "" || normalized === defaultValue) {
    delete record[key];
    return;
  }
  record[key] = normalized;
}

function setOptionalValue<T>(
  record: Record<string, unknown>,
  key: string,
  value: T,
  defaultValue: T,
): void {
  if (value === defaultValue) {
    delete record[key];
    return;
  }
  record[key] = value;
}

export function parseConfigEditorText(configText: string): {
  parsedConfig: FigmaPluginConfig;
  configError: string | null;
} {
  try {
    return {
      parsedConfig: parsePluginConfig(configText),
      configError: null,
    };
  } catch (error) {
    return {
      parsedConfig: {},
      configError: error instanceof Error ? error.message : "Invalid Figma config.",
    };
  }
}

export function getPresetControls(preset: Exclude<FigmaPresetId, "custom">): FigmaDirectControls {
  const controls = createInitialDirectControls();
  switch (preset) {
    case "responsive-story":
      return {
        ...controls,
        responsiveness: "dynamic",
      };
    case "image-only-graphic":
      return {
        ...controls,
        imageFormat: "png",
        renderTextAs: "image",
        renderRotatedSkewedTextAs: "image",
      };
    case "standard-story":
    default:
      return controls;
  }
}

export function directControlsFromConfig(config: FigmaPluginConfig): FigmaDirectControls {
  return {
    projectName: config.settings?.projectName ?? defaultSettings.projectName,
    output: config.settings?.output ?? defaultSettings.output,
    headline: config.metadata?.headline ?? "",
    altText: config.metadata?.altText ?? "",
    imageAltText: config.metadata?.imageAltText ?? "",
    ariaRole: config.metadata?.ariaRole ?? "",
    responsiveness: config.settings?.responsiveness ?? defaultSettings.responsiveness,
    imageFormat: config.settings?.imageFormat?.[0] ?? defaultSettings.imageFormat[0] ?? "auto",
    centerHtmlOutput: config.settings?.centerHtmlOutput ?? defaultSettings.centerHtmlOutput,
    renderTextAs: config.settings?.renderTextAs ?? defaultSettings.renderTextAs,
    renderRotatedSkewedTextAs:
      config.settings?.renderRotatedSkewedTextAs ?? defaultSettings.renderRotatedSkewedTextAs,
    googleFonts: config.settings?.googleFonts ?? defaultSettings.googleFonts,
    responsiveImageMode:
      config.settings?.responsiveImageMode ?? defaultSettings.responsiveImageMode,
  };
}

export function detectPresetFromControls(controls: FigmaDirectControls): FigmaPresetId {
  const presetComparable = {
    output: controls.output,
    responsiveness: controls.responsiveness,
    imageFormat: controls.imageFormat,
    centerHtmlOutput: controls.centerHtmlOutput,
    renderTextAs: controls.renderTextAs,
    renderRotatedSkewedTextAs: controls.renderRotatedSkewedTextAs,
    googleFonts: controls.googleFonts,
    responsiveImageMode: controls.responsiveImageMode,
  };
  const presets: Exclude<FigmaPresetId, "custom">[] = [
    "standard-story",
    "responsive-story",
    "image-only-graphic",
  ];
  for (const preset of presets) {
    const presetControls = getPresetControls(preset);
    const presetComparableTarget = {
      output: presetControls.output,
      responsiveness: presetControls.responsiveness,
      imageFormat: presetControls.imageFormat,
      centerHtmlOutput: presetControls.centerHtmlOutput,
      renderTextAs: presetControls.renderTextAs,
      renderRotatedSkewedTextAs: presetControls.renderRotatedSkewedTextAs,
      googleFonts: presetControls.googleFonts,
      responsiveImageMode: presetControls.responsiveImageMode,
    };
    if (JSON.stringify(presetComparable) === JSON.stringify(presetComparableTarget)) {
      return preset;
    }
  }
  return "custom";
}

export function applyDirectControlsToConfig(
  config: FigmaPluginConfig,
  controls: FigmaDirectControls,
): FigmaPluginConfig {
  const next = cloneConfig(config);
  const settings = { ...(next.settings ?? {}) } as Record<string, unknown>;
  const metadata = { ...(next.metadata ?? {}) } as Record<string, unknown>;

  setOptionalString(settings, "projectName", controls.projectName, defaultSettings.projectName);
  setOptionalValue(settings, "output", controls.output, defaultSettings.output);
  setOptionalValue(
    settings,
    "responsiveness",
    controls.responsiveness,
    defaultSettings.responsiveness,
  );
  if (controls.imageFormat === defaultSettings.imageFormat[0]) {
    delete settings.imageFormat;
  } else {
    settings.imageFormat = [controls.imageFormat];
  }
  setOptionalValue(
    settings,
    "centerHtmlOutput",
    controls.centerHtmlOutput,
    defaultSettings.centerHtmlOutput,
  );
  setOptionalValue(settings, "renderTextAs", controls.renderTextAs, defaultSettings.renderTextAs);
  setOptionalValue(
    settings,
    "renderRotatedSkewedTextAs",
    controls.renderRotatedSkewedTextAs,
    defaultSettings.renderRotatedSkewedTextAs,
  );
  setOptionalValue(settings, "googleFonts", controls.googleFonts, defaultSettings.googleFonts);
  setOptionalValue(
    settings,
    "responsiveImageMode",
    controls.responsiveImageMode,
    defaultSettings.responsiveImageMode,
  );

  setOptionalString(metadata, "headline", controls.headline);
  setOptionalString(metadata, "altText", controls.altText);
  setOptionalString(metadata, "imageAltText", controls.imageAltText);
  setOptionalString(metadata, "ariaRole", controls.ariaRole);

  next.settings = settings as FigmaPluginConfig["settings"];
  next.metadata = metadata as FigmaPluginConfig["metadata"];

  return cleanupConfig(next);
}

export function serializePluginConfig(config: FigmaPluginConfig): string {
  const cleaned = cleanupConfig(config);
  if (Object.keys(cleaned).length === 0) {
    return "";
  }
  return JSON.stringify(cleaned, null, 2);
}

export function hydrateUiStateFromLocalState(
  state: FigmaUiState,
  localState: FigmaLocalUiState,
): void {
  state.format = localState.format;
  state.advancedOpen = localState.advancedOpen;
  state.moreSettingsOpen = localState.moreSettingsOpen;
  state.preset = localState.preset;
}

export function buildLocalUiState(state: FigmaUiState): FigmaLocalUiState {
  return {
    format: state.format,
    advancedOpen: state.advancedOpen,
    moreSettingsOpen: state.moreSettingsOpen,
    preset: state.preset,
  };
}

export function selectionModeLabel(selection: SelectionSummary): string {
  if (selection.error) {
    return "Selection issue";
  }
  switch (selection.exportKind) {
    case "single":
      return "Single-frame export";
    case "responsive":
      return "Responsive group export";
    case "mixed":
      return "Mixed single + responsive export";
    default:
      return "No eligible frames";
  }
}

export function selectionSummaryCopy(selection: SelectionSummary): string {
  if (selection.error) {
    return "Selection needs attention before exporting.";
  }
  if (selection.eligibleFrames === 0) {
    return "Select one or more top-level frames before exporting.";
  }

  const responsiveGroups = selection.groups.filter((group) => group.mode === "responsive").length;
  const singleFrames = selection.groups.filter((group) => group.mode === "single").length;
  const parts: string[] = [];
  if (responsiveGroups > 0) {
    parts.push(`${responsiveGroups} responsive ${responsiveGroups === 1 ? "group" : "groups"}`);
  }
  if (singleFrames > 0) {
    parts.push(`${singleFrames} single ${singleFrames === 1 ? "frame" : "frames"}`);
  }
  const summary = parts.join(", ");
  return `${selection.eligibleFrames} ${selection.eligibleFrames === 1 ? "frame" : "frames"} selected${summary ? `. ${summary}.` : "."}`;
}

export function getValidationMessages(
  selection: SelectionSummary,
  configError: string | null,
): string[] {
  const messages: string[] = [];
  if (selection.error) {
    messages.push(selection.error);
  }
  if (configError) {
    messages.push(configError);
  }
  return messages;
}

export function isExportBlocked(selection: SelectionSummary, configError: string | null): boolean {
  return Boolean(configError || selection.error || selection.eligibleFrames === 0);
}

export function shouldShowReadyStatus(
  selection: SelectionSummary,
  configError: string | null,
): boolean {
  return !isExportBlocked(selection, configError);
}

export function exportBlockedMessage(selection: SelectionSummary): string {
  return selection.error ?? "Select one or more top-level frames before exporting.";
}

export function exportWarningNoticeCopy(
  warningCount: number,
): { title: string; detail: string } | null {
  if (warningCount <= 0) {
    return null;
  }
  const label = `${warningCount} warning${warningCount === 1 ? "" : "s"}`;
  return {
    title: `Exported with ${label}.`,
    detail: "Review Last export below for details.",
  };
}
