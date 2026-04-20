import type { EmitterReadyDocument } from "../ir/types.js";
import { emitHTML } from "./html.js";
import { renderDefaultStandaloneHTML } from "./standalone-shared.js";
import type { EmitterOptions } from "./types.js";

export interface EmitStandaloneResult {
  html: string;
  warnings: string[];
}

export function emitStandaloneBrowser(
  doc: EmitterReadyDocument,
  options?: EmitterOptions,
): EmitStandaloneResult {
  const { html: fragment, warnings } = emitHTML(doc, undefined, options);
  return {
    html: renderDefaultStandaloneHTML(doc, fragment),
    warnings,
  };
}
