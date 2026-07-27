import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyTemplate } from "../core/template.js";
import { createWarning, type StructuredWarning, warningMessages } from "../core/warnings.js";
import type { EmitterReadyDocument } from "../ir/types.js";
import { emitHTML } from "./html.js";
import { renderDefaultStandaloneHTML } from "./standalone-shared.js";
import type { EmitterOptions } from "./types.js";

export interface EmitStandaloneResult {
  html: string;
  /** Plain-string projection of `structuredWarnings`. */
  warnings: string[];
  structuredWarnings: StructuredWarning[];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function emitStandalone(
  doc: EmitterReadyDocument,
  options?: EmitterOptions,
): EmitStandaloneResult {
  const { html: fragment, structuredWarnings } = emitHTML(doc, undefined, options);
  const warnings = [...structuredWarnings];
  const settings = doc.settings;

  // If local_preview_template is set, use it
  if (settings.localPreviewTemplate) {
    try {
      const templatePath = resolve(settings.localPreviewTemplate);
      const template = readFileSync(templatePath, "utf-8");

      // Build replacements from settings + metadata
      const replacements: Record<string, string> = {};
      for (const [key, value] of Object.entries(settings)) {
        if (typeof value === "string") replacements[key] = value;
      }
      for (const [key, value] of Object.entries(doc.metadata)) {
        if (typeof value === "string") replacements[key] = value;
      }
      replacements.ai2htmlPartial = fragment;
      replacements.all2htmlPartial = fragment;

      const html = applyTemplate(template, replacements);
      return { html, warnings: warningMessages(warnings), structuredWarnings: warnings };
    } catch (err: unknown) {
      warnings.push(
        createWarning(
          "emit:template-error",
          "template",
          `Template error: ${getErrorMessage(err)}. Falling back to default.`,
          { setting: "localPreviewTemplate" },
        ),
      );
    }
  }

  return {
    html: renderDefaultStandaloneHTML(doc, fragment),
    warnings: warningMessages(warnings),
    structuredWarnings: warnings,
  };
}
