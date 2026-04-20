import { type All2HtmlConfig, getEmitterConfig, parseConfigText } from "./core/config.js";
import type { ArtboardGroup } from "./core/group-artboards.js";
import type { ObservableLogger } from "./core/logger.js";
import { processDocumentShared } from "./core/pipeline-shared.js";
import { resolveSettingsPure } from "./core/resolve-settings-pure.js";
import { createBuiltinEmitters, type EmitResult } from "./emitters/registry-shared.js";
import { emitStandaloneBrowser } from "./emitters/standalone-browser.js";
import type { EmitterConfig } from "./emitters/types.js";
import { loadSVGImportFilesFromBrowser } from "./importers/svg/browser.js";
import {
  importSVGFilesWithRasterizer,
  type SVGImportOptions,
} from "./importers/svg/import-core.js";
import type { LoadedSVGImportFiles } from "./importers/svg/loaded.js";
import type {
  RasterizedImage,
  SvgRasterizeRequest,
  SvgRasterizer,
} from "./importers/svg/rasterizer.js";
import {
  type BrowserResvgModule,
  type BrowserSvgRasterizerOptions,
  createBrowserSvgRasterizer,
} from "./importers/svg/rasterizer-browser.js";
import type { EmitterReadyDocument } from "./ir/types.js";
import {
  bundleToZipBytes,
  createOutputBundle,
  getBundleFile,
  type OutputBundle,
  type OutputBundleFile,
} from "./output-bundle.js";

export interface BrowserPipelineOptions {
  inlineConfig?: All2HtmlConfig;
  logger?: ObservableLogger;
}

export interface BrowserPipelineResult {
  document: EmitterReadyDocument;
  groups: ArtboardGroup[];
  warnings: string[];
}

export interface BrowserEmitterDescriptor {
  name: "html" | "standalone" | "svelte" | "react";
  emitAll: (
    doc: EmitterReadyDocument,
    groups: ArtboardGroup[],
    emitterConfig?: EmitterConfig,
  ) => EmitResult;
}

export function processDocumentInBrowser(
  irJson: unknown,
  options: BrowserPipelineOptions = {},
): BrowserPipelineResult {
  return processDocumentShared(irJson, {
    logger: options.logger,
    resolveSettingsSpanData: { inlineConfig: options.inlineConfig ? "present" : "absent" },
    resolveSettings(raw) {
      return resolveSettingsPure(raw, {
        fonts: options.inlineConfig?.fonts,
        settings: options.inlineConfig?.settings,
      });
    },
  });
}

const browserEmitters = createBuiltinEmitters(emitStandaloneBrowser);

export function getBrowserEmitter(
  name: "html" | "standalone" | "svelte" | "react",
): BrowserEmitterDescriptor {
  return browserEmitters[name] as BrowserEmitterDescriptor;
}

export {
  type BrowserResvgModule,
  type BrowserSvgRasterizerOptions,
  bundleToZipBytes,
  createBrowserSvgRasterizer,
  createOutputBundle,
  getBundleFile,
  getEmitterConfig,
  importSVGFilesWithRasterizer,
  type LoadedSVGImportFiles,
  loadSVGImportFilesFromBrowser,
  type OutputBundle,
  type OutputBundleFile,
  parseConfigText,
  type RasterizedImage,
  type SVGImportOptions,
  type SvgRasterizeRequest,
  type SvgRasterizer,
};
