import type { All2HtmlConfig } from "./config.js";
import type { ObservableLogger } from "./logger.js";
import { processDocumentShared, type SharedPipelineResult } from "./pipeline-shared.js";
import { resolveSettings } from "./resolve-settings.js";
import { resolveSettingsPure } from "./resolve-settings-pure.js";

export interface PipelineOptions {
  configPath?: string;
  inlineConfig?: All2HtmlConfig;
  logger?: ObservableLogger;
}

export interface PipelineResult {
  document: SharedPipelineResult["document"];
  groups: SharedPipelineResult["groups"];
  warnings: SharedPipelineResult["warnings"];
}

export function processDocument(irJson: unknown, options: PipelineOptions = {}): PipelineResult {
  return processDocumentShared(irJson, {
    logger: options.logger,
    resolveSettingsSpanData: {
      configPath: options.configPath,
      inlineConfig: options.inlineConfig ? "present" : "absent",
    },
    resolveSettings(raw) {
      return options.inlineConfig
        ? resolveSettingsPure(raw, {
            fonts: options.inlineConfig.fonts,
            settings: options.inlineConfig.settings,
          })
        : resolveSettings(raw, options.configPath);
    },
  });
}
