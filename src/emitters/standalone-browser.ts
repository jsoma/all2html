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

export function emitStandaloneBrowser(
  doc: EmitterReadyDocument,
  options?: EmitterOptions,
): EmitStandaloneResult {
  const { html: fragment, structuredWarnings } = emitHTML(doc, undefined, options);
  const resultWarnings = [...structuredWarnings];

  if (doc.settings.localPreviewTemplate) {
    resultWarnings.push(
      createWarning(
        "setting:unsupported",
        "setting",
        "Browser standalone export ignores localPreviewTemplate.",
        { setting: "localPreviewTemplate", surface: "browser" },
      ),
    );
  }

  return {
    html: renderDefaultStandaloneHTML(doc, fragment),
    warnings: warningMessages(resultWarnings),
    structuredWarnings: resultWarnings,
  };
}
