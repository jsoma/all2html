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
export { getAvailableFormats, getEmitter } from "./emitters/registry.js";
export { emitStandalone } from "./emitters/standalone.js";
export { emitSvelte } from "./emitters/svelte.js";
export type {
  EmitterConfig,
  EmitterOptions,
  ReactEmitterOptions,
  SvelteEmitterOptions,
} from "./emitters/types.js";
export { getAvailableImporters, getImporter } from "./importers/registry.js";
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
  Asset,
  BoundingBox,
  CharacterRun,
  Color,
  ComputedPosition,
  ComputedTextStyle,
  CustomBlock,
  Document,
  Element,
  EmitterReadyArtboard,
  EmitterReadyDocument,
  EmitterReadyTextElement,
  FontMapping,
  Layer,
  Metadata,
  Paragraph,
  RawHtmlElement,
  ResolvedDocument,
  Settings,
  ShapeElement,
  SnippetElement,
  StyleClassEntry,
  StyledDocument,
  TextElement,
  VideoElement,
} from "./ir/types.js";
export { loadAndValidateIR } from "./ir/validate.js";
export {
  bundleToZipBytes,
  createOutputBundle,
  getBundleFile,
  type OutputBundle,
  type OutputBundleFile,
} from "./output-bundle.js";
