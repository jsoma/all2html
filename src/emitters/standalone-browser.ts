import { type StructuredWarning, warningMessages } from "../core/warnings.js";
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

/**
 * The public browser standalone emitter: every artboard in the document, one
 * file. Second argument is `EmitterOptions`, matching `emitStandalone` — see the
 * note there for why the group parameter is a separate named function rather
 * than an extra positional argument.
 */
export function emitStandaloneBrowser(
  doc: EmitterReadyDocument,
  options?: EmitterOptions,
): EmitStandaloneResult {
  return emitStandaloneBrowserGroup(doc, undefined, options);
}

/**
 * Internal, group-aware entry point used by the browser emitter registry.
 *
 * No `localPreviewTemplate` warning here. The surface capability checker in
 * `src/core/capabilities.ts` already warns for it once per run and knows the
 * real surface — this emitter is shared by the browser dropzone *and* the Figma
 * plugin, so a warning raised here was emitted a second time, once per output
 * group, and labelled `surface: "browser"` even on a Figma export.
 */
export function emitStandaloneBrowserGroup(
  doc: EmitterReadyDocument,
  groupOptions?: EmitGroupOptions,
  options?: EmitterOptions,
): EmitStandaloneResult {
  const { html: fragment, structuredWarnings } = emitHTML(doc, groupOptions, options);
  const resultWarnings = [...structuredWarnings];

  return {
    html: renderDefaultStandaloneHTML(doc, fragment),
    warnings: warningMessages(resultWarnings),
    structuredWarnings: resultWarnings,
  };
}
