import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyTemplate } from "../core/template.js";
import type { EmitterReadyDocument } from "../ir/types.js";
import { emitHTML } from "./html.js";
import { renderDefaultStandaloneHTML } from "./standalone-shared.js";
import type { EmitterOptions } from "./types.js";

export interface EmitStandaloneResult {
  html: string;
  warnings: string[];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function emitStandalone(
  doc: EmitterReadyDocument,
  options?: EmitterOptions,
): EmitStandaloneResult {
  const { html: fragment, warnings } = emitHTML(doc, undefined, options);
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
      return { html, warnings };
    } catch (err: unknown) {
      warnings.push(`Template error: ${getErrorMessage(err)}. Falling back to default.`);
    }
  }

  return { html: renderDefaultStandaloneHTML(doc, fragment), warnings };
}
