import type { EmitterReadyDocument } from "../ir/types.js";
import { type EmitGroupOptions, emitHTML } from "./html.js";
import { buildGoogleFontsUrl, stripGoogleFontsLinkTags } from "./shared/google-fonts.js";
import type { SvelteEmitterOptions } from "./types.js";

export interface EmitSvelteResult {
  svelte: string;
  warnings: string[];
}

const ASSETS_TOKEN = "__ALL2HTML_ASSETS__";

export function emitSvelte(
  doc: EmitterReadyDocument,
  groupOptions?: EmitGroupOptions,
  options?: SvelteEmitterOptions,
): EmitSvelteResult {
  // Override imageSourcePath so the HTML emitter places our token natively
  // in both src="..." and url(...) contexts (CSS custom property images).
  const tokenizedDoc: EmitterReadyDocument = {
    ...doc,
    settings: { ...doc.settings, imageSourcePath: `${ASSETS_TOKEN}/` },
  };
  const { html: fragment, warnings } = emitHTML(tokenizedDoc, groupOptions, options);

  // Extract <style> block and move to Svelte <style>
  const styleMatch = fragment.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  const css = styleMatch ? styleMatch[1] : "";
  const htmlWithoutStyle = stripGoogleFontsLinkTags(
    fragment.replace(/<style[^>]*>[\s\S]*?<\/style>\s*/, ""),
  );

  // Remove HTML comments (not valid in Svelte template)
  const tokenizedHtml = htmlWithoutStyle.replace(/<!--[\s\S]*?-->/g, "").trim();
  const googleFontsHref =
    tokenizedDoc.settings.googleFonts === "link" ? buildGoogleFontsUrl(tokenizedDoc.fonts) : null;
  const fontHead = googleFontsHref
    ? `<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${escapeHtmlAttr(googleFontsHref)}">
</svelte:head>

`
    : "";

  const svelte = `<script>
  let { assetsPath = ".", class: className = "" } = $props();

  // Replace asset path token in HTML at render time
  const ASSET_TOKEN = "${ASSETS_TOKEN}";

  function resolveHtml(html) {
    const safePath = assetsPath.replace(/\\/+$/, "");
    return html.split(ASSET_TOKEN).join(safePath);
  }
</script>

${fontHead}<div class={className}>
  {@html resolveHtml(\`${escapeTemplateLiteral(tokenizedHtml)}\`)}
</div>

<style>
${css}
</style>
`;

  return { svelte, warnings };
}

function escapeTemplateLiteral(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
