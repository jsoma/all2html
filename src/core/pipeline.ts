import type { SurfaceContext } from "./capabilities.js";
import { type All2HtmlConfig, parseConfigObject } from "./config.js";
import type { ObservableLogger } from "./logger.js";
import { processDocumentShared, type SharedPipelineResult } from "./pipeline-shared.js";
import { resolveSettings } from "./resolve-settings.js";

export interface PipelineOptions {
  /**
   * Parsed config, supplied by the surface. The pipeline does no file I/O —
   * the CLI reads and parses its `--config` file exactly once per run (or per
   * watch rebuild) and passes the object here.
   */
  inlineConfig?: All2HtmlConfig;
  logger?: ObservableLogger;
  /** Defaults to the Node CLI on its `render` path. */
  surface?: SurfaceContext;
}

export interface PipelineResult {
  document: SharedPipelineResult["document"];
  groups: SharedPipelineResult["groups"];
  warnings: SharedPipelineResult["warnings"];
  structuredWarnings: SharedPipelineResult["structuredWarnings"];
}

export function processDocument(irJson: unknown, options: PipelineOptions = {}): PipelineResult {
  // Runtime-validate the object we were handed: `inlineConfig` is typed, but a
  // JavaScript caller can pass anything, and this is the pipeline's only config
  // entry point now that file paths are gone. One validator (`parseConfigObject`
  // is what `parseConfigText` itself uses).
  const inlineConfig = options.inlineConfig ? parseConfigObject(options.inlineConfig) : undefined;
  return processDocumentShared(irJson, {
    logger: options.logger,
    surface: options.surface ?? { surface: "cli", path: "render" },
    resolveSettingsSpanData: {
      inlineConfig: inlineConfig ? "present" : "absent",
    },
    resolveSettings(raw) {
      return resolveSettings(raw, {
        fonts: inlineConfig?.fonts,
        settings: inlineConfig?.settings,
      });
    },
  });
}
