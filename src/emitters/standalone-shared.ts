import type { EmitterReadyDocument } from "../ir/types.js";
import { escapeHtml } from "./shared/hast-helpers.js";

export function renderDefaultStandaloneHTML(doc: EmitterReadyDocument, fragment: string): string {
  const title = doc.metadata.headline || doc.settings.projectName || doc.metadata.slug;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(doc.metadata.lang || "en")}">
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
