import { artifactAssetBase } from "./core/artifact-path.js";
import type { SurfaceContext } from "./core/capabilities.js";
import { type All2HtmlConfig, getEmitterConfig, parseConfigText } from "./core/config.js";
import type { ArtboardGroup } from "./core/group-artboards.js";
import type { ObservableLogger } from "./core/logger.js";
import { processDocumentShared } from "./core/pipeline-shared.js";
import { resolveSettingsPure } from "./core/resolve-settings-pure.js";
import type { StructuredWarning } from "./core/warnings.js";
import {
  createBuiltinEmitters,
  type EmitResult,
  formatDictatedExtension,
} from "./emitters/registry-shared.js";
import { emitStandaloneBrowserGroup } from "./emitters/standalone-browser.js";
import { type ResolvedEmitterConfig, withAssetBase } from "./emitters/types.js";
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
  assertSafeBundleEntryPath,
  bundleToZipBytes,
  createOutputBundle,
  getBundleFile,
  type OutputBundle,
  type OutputBundleFile,
} from "./output-bundle.js";

export interface BrowserPipelineOptions {
  inlineConfig?: All2HtmlConfig;
  logger?: ObservableLogger;
  /** Defaults to the browser converter on its SVG import path. */
  surface?: SurfaceContext;
  /**
   * Emitter format this run is targeting. Folded into the default surface
   * context, because format-qualified declarations (`unsupportedFormats:
   * ["standalone"]`) cannot fire without it.
   */
  format?: string;
}

export interface BrowserPipelineResult {
  document: EmitterReadyDocument;
  groups: ArtboardGroup[];
  /** Plain-string projection of `structuredWarnings`. */
  warnings: string[];
  structuredWarnings: StructuredWarning[];
}

export interface BrowserEmitterDescriptor {
  name: string;
  emitAll: (
    doc: EmitterReadyDocument,
    groups: ArtboardGroup[],
    emitterConfig?: ResolvedEmitterConfig,
  ) => EmitResult;
}

export interface BrowserSvgConversionOptions {
  loaded: LoadedSVGImportFiles;
  format: string;
  formatLabel?: string;
  slug?: string;
  parsedConfig?: All2HtmlConfig;
  rasterizer: SvgRasterizer;
  importFiles?: typeof importSVGFilesWithRasterizer;
  process?: typeof processDocumentInBrowser;
  emitter?: typeof getBrowserEmitter;
  buildBundle?: typeof createOutputBundle;
}

export interface BrowserSvgConversionResult {
  loaded: LoadedSVGImportFiles;
  slug: string;
  format: string;
  irDocument: Awaited<ReturnType<typeof importSVGFilesWithRasterizer>>["document"];
  bundle: OutputBundle;
  emittedPath: string;
  importWarnings: string[];
  renderWarnings: string[];
  artboardCount: number;
  groupCount: number;
  assetCount: number;
  filePaths: string[];
}

export function processDocumentInBrowser(
  irJson: unknown,
  options: BrowserPipelineOptions = {},
): BrowserPipelineResult {
  return processDocumentShared(irJson, {
    logger: options.logger,
    surface: options.surface ?? { surface: "browser", path: "import", format: options.format },
    resolveSettingsSpanData: { inlineConfig: options.inlineConfig ? "present" : "absent" },
    resolveSettings(raw) {
      return resolveSettingsPure(raw, {
        fonts: options.inlineConfig?.fonts,
        settings: options.inlineConfig?.settings,
      });
    },
  });
}

export async function convertLoadedSvgFilesInBrowser(
  options: BrowserSvgConversionOptions,
): Promise<BrowserSvgConversionResult> {
  const slug = options.slug?.trim() || options.loaded.slug;
  const importFiles = options.importFiles ?? importSVGFilesWithRasterizer;
  const process = options.process ?? processDocumentInBrowser;
  const emitter = options.emitter ?? getBrowserEmitter;
  const buildBundle = options.buildBundle ?? createOutputBundle;

  const imported = await importFiles(options.loaded.files, {
    slug,
    entrypointPaths: options.loaded.entrypointPaths,
    settings: options.parsedConfig?.settings,
    rasterizer: options.rasterizer,
  });
  const emitterConfig = getEmitterConfig(options.parsedConfig);
  const processed = process(imported.document, {
    inlineConfig: options.parsedConfig,
    surface: {
      surface: "browser",
      path: "import",
      format: options.format,
      // What this run writes, not what the format might write: react is `.tsx`
      // or `.jsx` depending on the emitter config, and the settings the checker
      // sees do not carry that.
      formatExtension: formatDictatedExtension(options.format, emitterConfig),
    },
  });
  // `createOutputBundle` puts the emitted files at the bundle root and every
  // asset at `assetRoot + asset.path`, so the path from an emitted file to an
  // asset *is* `assetRoot`. One value, read once, handed to both sides — the
  // emitted `src` and the bundle layout cannot disagree.
  const assetRoot = artifactAssetBase(processed.document.settings.imageOutputPath || "");
  const emitResult = emitter(options.format).emitAll(
    processed.document,
    processed.groups,
    withAssetBase(emitterConfig, assetRoot),
  );
  if (emitResult.files.length === 0) {
    throw new Error(`No ${options.formatLabel ?? options.format} files were emitted.`);
  }
  const renderWarnings = [...processed.warnings, ...emitResult.warnings];
  const bundle = buildBundle({
    irDocument: imported.document,
    emittedFiles: emitResult.files,
    assetFiles: imported.assetFiles,
    assetRoot,
    emittedFormat: options.format,
    warnings: [...imported.warnings, ...renderWarnings],
  });

  return {
    loaded: options.loaded,
    slug,
    format: options.format,
    irDocument: imported.document,
    bundle,
    emittedPath: `${emitResult.files[0].slug}${emitResult.files[0].extension}`,
    importWarnings: imported.warnings,
    renderWarnings,
    artboardCount: processed.document.artboards.length,
    groupCount: processed.groups.length,
    assetCount: imported.assetFiles.length,
    filePaths: emitResult.files.map((file) => `${file.slug}${file.extension}`),
  };
}

const browserEmitters = createBuiltinEmitters(emitStandaloneBrowserGroup);
const browserEmitterRegistry = new Map<string, BrowserEmitterDescriptor>(
  Object.entries(browserEmitters).map(([name, emitter]) => [
    name,
    emitter as BrowserEmitterDescriptor,
  ]),
);

export function registerBrowserEmitter(emitter: BrowserEmitterDescriptor): void {
  if (!emitter.name) {
    throw new Error("Browser emitter name is required.");
  }
  browserEmitterRegistry.set(emitter.name, emitter);
}

export function getBrowserEmitter(name: string): BrowserEmitterDescriptor {
  const emitter = browserEmitterRegistry.get(name);
  if (!emitter) {
    const available = Array.from(browserEmitterRegistry.keys()).sort().join(", ");
    throw new Error(`Unknown browser format: "${name}". Available: ${available}`);
  }
  return emitter;
}

export function getAvailableBrowserFormats(): string[] {
  return Array.from(browserEmitterRegistry.keys()).sort((a, b) => a.localeCompare(b));
}

export {
  assertSafeBundleEntryPath,
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
