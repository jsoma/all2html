import type { EmitterReadyDocument } from "../ir/types.js";
import { escapeAttr, escapeHtml } from "./shared/escape.js";

export function renderDefaultStandaloneHTML(doc: EmitterReadyDocument, fragment: string): string {
  const title = doc.metadata.headline || doc.settings.projectName || doc.metadata.slug;

  return `<!DOCTYPE html>
<html lang="${escapeAttr(doc.metadata.lang || "en")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body>
${fragment}
</body>
</html>`;
}
