/// <reference types="@figma/plugin-typings" />

import { parsePluginConfig } from "./config.js";
import { buildExportBundle, createZipArchive } from "./export.js";
import { extractFrameInfo, getSelectedTopLevelFrames, groupFrameInfos } from "./extract/frames.js";
import { FigmaPluginError } from "./errors.js";
import { isUiToSandboxMessage } from "./messages.js";
import {
  loadLocalUiState,
  loadSharedConfig,
  saveLocalUiState,
  saveSharedConfig,
} from "./persistence.js";
import { extractFramesFromSelection } from "./runtime-extract.js";
import { buildDocument } from "./ir-builder.js";
import type {
  ExtractedFrame,
  FigmaLocalUiState,
  FigmaOutputFormat,
  SandboxToUiMessage,
  SelectionExportKind,
  SelectionNodeLike,
  SelectionSummary,
  UiToSandboxMessage,
} from "./types.js";

declare const __UI_HTML__: string;

export function summarizeSelection(selection: readonly SelectionNodeLike[]): SelectionSummary {
  const frames = getSelectedTopLevelFrames(selection);
  const infos = frames.map(extractFrameInfo);
  const groups = groupFrameInfos(infos);
  const groupSummaries: SelectionSummary["groups"] = groups.map((group) => {
    const mode = group.frames.length > 1 ? "responsive" : "single";
    return {
      name: group.name,
      frameCount: group.frames.length,
      frameNames: group.frames.map((frame) => frame.originalName),
      widths: group.frames.map((frame) => frame.width),
      mode,
    };
  });
  let exportKind: SelectionExportKind = "empty";
  if (groupSummaries.length > 0) {
    const responsiveCount = groupSummaries.filter((group) => group.mode === "responsive").length;
    if (responsiveCount === 0) {
      exportKind = "single";
    } else if (responsiveCount === groupSummaries.length) {
      exportKind = "responsive";
    } else {
      exportKind = "mixed";
    }
  }

  return {
    totalSelected: selection.length,
    eligibleFrames: frames.length,
    frameNames: frames.map((frame) => frame.name),
    groupNames: groups.map((group) => group.name),
    groups: groupSummaries,
    exportKind,
  };
}

function postToUi(message: SandboxToUiMessage): void {
  figma.ui.postMessage(message);
}

function summarizeCurrentSelection(): SelectionSummary {
  try {
    return summarizeSelection(figma.currentPage.selection);
  } catch (error) {
    if (figma.currentPage.selection.length === 0) {
      return {
        totalSelected: 0,
        eligibleFrames: 0,
        frameNames: [],
        groupNames: [],
        groups: [],
        exportKind: "empty",
      };
    }

    return {
      totalSelected: figma.currentPage.selection.length,
      eligibleFrames: 0,
      frameNames: [],
      groupNames: [],
      groups: [],
      exportKind: "empty",
      error: error instanceof Error ? error.message : "Failed to summarize current selection.",
    };
  }
}

export function exportExtractedFrames(
  frames: readonly ExtractedFrame[],
  options: {
    slug: string;
    configText?: string;
    format?: FigmaOutputFormat;
    pluginVersion?: string;
    figmaVersion?: string;
  },
) {
  const config = parsePluginConfig(options.configText);
  const ir = buildDocument(frames, {
    slug: options.slug,
    pluginVersion: options.pluginVersion,
    figmaVersion: options.figmaVersion,
    settings: config.settings,
    metadata: config.metadata,
    fonts: config.fonts,
    customBlocks: config.customBlocks,
  });
  const bundle = buildExportBundle(ir, {
    format: options.format ?? "html",
    assetFiles: frames.flatMap((frame) => frame.assets ?? []),
  });
  const zip = createZipArchive(bundle);

  return {
    config,
    ir,
    bundle,
    zip,
  };
}

async function publishSelectionSummary(): Promise<void> {
  postToUi({
    type: "selection-summary",
    selection: summarizeCurrentSelection(),
  });
}

async function handleLoadConfig(): Promise<void> {
  const [configText, localState] = await Promise.all([
    Promise.resolve(loadSharedConfig(figma.root)),
    loadLocalUiState(figma.clientStorage),
  ]);

  postToUi({
    type: "config-loaded",
    configText,
    localState,
  });
}

async function handleSaveLocalUiState(localState: FigmaLocalUiState): Promise<void> {
  await saveLocalUiState(figma.clientStorage, localState);
}

async function handleSaveConfig(configText: string): Promise<void> {
  parsePluginConfig(configText);
  const saved = saveSharedConfig(figma.root, configText);
  postToUi({ type: "config-saved", configText: saved });
}

async function handleExport(configText: string, format: FigmaOutputFormat): Promise<void> {
  const parsedConfig = parsePluginConfig(configText);
  const frames = getSelectedTopLevelFrames(figma.currentPage.selection) as FrameNode[];
  if (frames.length === 0) {
    throw new FigmaPluginError("Select one or more top-level frames before exporting.");
  }

  const sharedConfig = saveSharedConfig(figma.root, configText);
  const localState = await loadLocalUiState(figma.clientStorage);
  await saveLocalUiState(figma.clientStorage, { ...localState, format });

  const summary = summarizeSelection(frames);
  const slug =
    parsedConfig.settings?.projectName?.trim() ||
    summary.groupNames[0] ||
    summary.frameNames[0] ||
    "all2html-figma";
  const { frames: extractedFrames, warnings: extractWarnings } = await extractFramesFromSelection(frames, {
    slug,
  });

  const result = exportExtractedFrames(extractedFrames, {
    slug,
    configText: sharedConfig,
    format,
    figmaVersion: figma.apiVersion,
  });
  const warnings = [...extractWarnings, ...result.bundle.warnings];

  postToUi({
    type: "export-success",
    format,
    fileCount: result.bundle.entries.length,
    files: result.bundle.entries.map((entry) => entry.path),
    warningCount: warnings.length,
    warnings,
    zipFilename: `${slug}.zip`,
    zipBytes: Array.from(result.zip),
  });
}

export async function handleUiMessage(message: UiToSandboxMessage): Promise<void> {
  switch (message.type) {
    case "get-selection-summary":
      await publishSelectionSummary();
      return;
    case "load-config":
      await handleLoadConfig();
      return;
    case "save-local-ui-state":
      await handleSaveLocalUiState(message.localState);
      return;
    case "save-config":
      await handleSaveConfig(message.configText);
      return;
    case "export":
      await handleExport(message.configText, message.format);
      return;
  }
}

export function initializePlugin(): void {
  if (typeof figma === "undefined") {
    return;
  }

  figma.skipInvisibleInstanceChildren = true;
  figma.showUI(__UI_HTML__, { width: 460, height: 640, themeColors: true, title: "all2html" });

  figma.ui.onmessage = async (message: unknown) => {
    if (!isUiToSandboxMessage(message)) {
      postToUi({ type: "export-error", message: "Received invalid UI message." });
      return;
    }

    try {
      await handleUiMessage(message);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      postToUi({
        type: "export-error",
        message: err.message,
      });
    }
  };

  figma.on("selectionchange", () => {
    void publishSelectionSummary();
  });

  void publishSelectionSummary();
  void handleLoadConfig();
}

if (typeof figma !== "undefined") {
  initializePlugin();
}
