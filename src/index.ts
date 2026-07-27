export {
  type All2HtmlConfig,
  getConfigFonts,
  getConfigSettings,
  getEmitterConfig,
  parseConfigText,
} from "./core/config.js";
export {
  createCollectingLogger,
  createConsoleLogger,
  type Logger,
  noopLogger,
  type ObservableLogger,
  type Span,
  type StructuredEvent,
} from "./core/logger.js";
export { processDocument } from "./core/pipeline.js";
export { parseEmitterConfig } from "./core/resolve-settings.js";
export { emitHTML } from "./emitters/html.js";
export { emitHTMLString } from "./emitters/html-string.js";
export { emitReact } from "./emitters/react.js";
export type { EmitFile, EmitResult, EmitterDescriptor } from "./emitters/registry.js";
export { getAvailableFormats, getEmitter, registerEmitter } from "./emitters/registry.js";
export { emitStandalone } from "./emitters/standalone.js";
export { emitSvelte } from "./emitters/svelte.js";
export type {
  EmitterConfig,
  EmitterOptions,
  ReactEmitterOptions,
  SvelteEmitterOptions,
} from "./emitters/types.js";
export { getAvailableImporters, getImporter, registerImporter } from "./importers/registry.js";
export { loadSVGImportFilesFromBrowser } from "./importers/svg/browser.js";
export {
  importSVGFiles,
  importSVGFilesWithRasterizer,
  type SVGImportOptions,
} from "./importers/svg/import.js";
export type { LoadedSVGImportFiles } from "./importers/svg/loaded.js";
export type {
  RasterizedImage,
  SvgRasterizeRequest,
  SvgRasterizer,
} from "./importers/svg/rasterizer.js";
export {
  type BrowserResvgModule,
  type BrowserSvgRasterizerOptions,
  createBrowserSvgRasterizer,
} from "./importers/svg/rasterizer-browser.js";
export type {
  ImportedAssetFile,
  ImportedFile,
  ImporterDescriptor,
  ImportOptions,
  ImportResult,
} from "./importers/types.js";
export type {
  Artboard,
  ArtboardBreakpoint,
  Asset,
  BoundingBox,
  BreakpointedArtboard,
  BreakpointedDocument,
  CharacterRun,
  Color,
  ComputedPosition,
  ComputedTextStyle,
  CustomBlock,
  DeduplicatedArtboard,
  DeduplicatedDocument,
  DeduplicatedElement,
  DeduplicatedLayer,
  DeduplicatedTextElement,
  Document,
  Element,
  EmitterReadyArtboard,
  EmitterReadyDocument,
  EmitterReadyElement,
  EmitterReadyLayer,
  EmitterReadyShapeElement,
  EmitterReadySnippetElement,
  EmitterReadyTextElement,
  FontMapping,
  HtmlTextElement,
  ImageTextElement,
  Layer,
  Metadata,
  Paragraph,
  PhaseDocument,
  PipelinePhase,
  RawHtmlElement,
  ResolvedArtboard,
  ResolvedDocument,
  Settings,
  ShapeElement,
  SnippetElement,
  SourceMetadata,
  StyleClassEntry,
  StyledArtboard,
  StyledDocument,
  StyledElement,
  StyledLayer,
  StyledTextElement,
  TextElement,
  VideoElement,
} from "./ir/types.js";
export { CURRENT_IR_VERSION } from "./ir/types.js";
export { loadAndValidateIR } from "./ir/validate.js";
export {
  assertSafeBundleEntryPath,
  bundleToZipBytes,
  createOutputBundle,
  getBundleFile,
  type OutputBundle,
  type OutputBundleFile,
  type OutputBundleManifest,
  type OutputBundleManifestFile,
} from "./output-bundle.js";
