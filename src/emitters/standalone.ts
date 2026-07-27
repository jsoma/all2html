import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyTemplate, rawTemplateValue, type TemplateValue } from "../core/template.js";
import { createWarning, type StructuredWarning, warningMessages } from "../core/warnings.js";
import type { EmitterReadyDocument } from "../ir/types.js";
import { emitHTML } from "./html.js";
import type { EmitGroupOptions } from "./html-tree.js";
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

/**
 * The public standalone emitter: every artboard in the document, one file.
 *
 * **The second argument is `EmitterOptions` and must stay that way.** This is a
 * root export (`src/index.ts`), so an existing JavaScript caller writing
 * `emitStandalone(doc, { allowUnsafeHtml: false })` gets no type error if the
 * parameter list changes underneath it — the object is simply read as something
 * else and the options are dropped, silently re-enabling unsafe binding HTML.
 * That is exactly what happened when group support was added here as a new
 * *second* parameter. Group-aware callers use the explicitly named
 * `emitStandaloneGroup` below; nothing discriminates by argument shape, because
 * shape-sniffing is the ambiguity that caused the regression.
 */
export function emitStandalone(
  doc: EmitterReadyDocument,
  options?: EmitterOptions,
): EmitStandaloneResult {
  return emitStandaloneGroup(doc, undefined, options);
}

/**
 * Internal, group-aware entry point used by the emitter registry.
 *
 * `groupOptions` is the same artboard-subset + slug override every other emitter
 * takes. It used to be missing, which made `output: "multiple-files"` a silent
 * no-op on this format: the registry passed the groups in and standalone dropped
 * them, emitting one file containing every artboard while `html`, `svelte` and
 * `react` emitted one per group.
 */
export function emitStandaloneGroup(
  doc: EmitterReadyDocument,
  groupOptions?: EmitGroupOptions,
  options?: EmitterOptions,
): EmitStandaloneResult {
  const { html: fragment, structuredWarnings } = emitHTML(doc, groupOptions, options);
  const warnings = [...structuredWarnings];
  const settings = doc.settings;

  // If local_preview_template is set, use it
  if (settings.localPreviewTemplate) {
    try {
      const templatePath = resolve(settings.localPreviewTemplate);
      const template = readFileSync(templatePath, "utf-8");

      // Build replacements from settings + metadata. These are user text — a
      // headline, a credit line — and land in an arbitrary position in someone
      // else's template, so they go in raw and `applyTemplate` escapes them for
      // whichever position its tokenizer finds them in. The emitted fragment is
      // the one value that IS markup, so it is the one value marked raw.
      const replacements: Record<string, TemplateValue> = {};
      for (const [key, value] of Object.entries(settings)) {
        if (typeof value === "string") replacements[key] = value;
      }
      for (const [key, value] of Object.entries(doc.metadata)) {
        if (typeof value === "string") replacements[key] = value;
      }
      replacements.ai2htmlPartial = rawTemplateValue(fragment);
      replacements.all2htmlPartial = rawTemplateValue(fragment);

      // `applyTemplate` classifies every slot by the grammar position it lands
      // in and refuses the ones no escape can make safe (attribute name, tag
      // name, unquoted attribute value, `script`/`style` raw text). Those come
      // back as warnings and must reach the caller's result — a slot that was
      // silently dropped is exactly the report an author needs to fix the file.
      const { output: html, warnings: templateWarnings } = applyTemplate(template, replacements, {
        setting: "localPreviewTemplate",
      });
      for (const warning of templateWarnings) warnings.push(warning);
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
