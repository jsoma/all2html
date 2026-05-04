import { makeArtboardKey } from "../../core/identifiers.js";
import type { ComputedTextStyle, EmitterReadyDocument } from "../../ir/types.js";
import { renderGoogleFontsImport } from "./google-fonts.js";

export { makeArtboardKey, makeKeyword } from "../../core/identifiers.js";

function formatStyleRule(style: ComputedTextStyle): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => {
      const prop = k.replace(/([A-Z])/g, "-$1").toLowerCase();
      return `  ${prop}: ${v};`;
    })
    .join("\n");
}

/**
 * Whether to use CSS custom property image loading.
 * When true, artboard background images use `background-image: var(--{keyword}-img)`
 * inside container queries, preventing browsers from downloading hidden artboard images.
 */
export type FitMode = "width" | "height" | "cover";
export type ResponsiveImageMode = "img-src" | "css-var";

export function useCssVarImages(
  doc: EmitterReadyDocument,
  responsiveImageMode?: ResponsiveImageMode,
): boolean {
  const mode = responsiveImageMode ?? doc.settings.responsiveImageMode ?? "img-src";
  return doc.artboards.length > 1 && doc.settings.includeResizerCss && mode === "css-var";
}

export interface CSSOptions {
  slug?: string;
  fitMode?: FitMode;
  responsiveImageMode?: ResponsiveImageMode;
}

export interface CSSResult {
  css: string;
  warnings: string[];
}

export function generateCSS(doc: EmitterReadyDocument, options?: CSSOptions): CSSResult {
  const settings = doc.settings;
  const ns = settings.namespace;
  const slug = options?.slug || settings.projectName || doc.metadata.slug;
  const containerId = `${ns}${slug}-box`;
  const hasMultipleArtboards = doc.artboards.length > 1;
  const cssVarImages = useCssVarImages(doc, options?.responsiveImageMode);
  const fitMode = options?.fitMode ?? "width";
  const warnings: string[] = [];
  const lines: string[] = [];

  // fitMode interaction rules
  if (fitMode === "cover" && settings.maxWidth) {
    warnings.push("fitMode 'cover' ignores maxWidth setting");
  }

  if (settings.googleFonts === "import") {
    const fontImport = renderGoogleFontsImport(doc.fonts);
    if (fontImport) lines.push(fontImport);
  }

  // Container queries setup
  if (hasMultipleArtboards && settings.includeResizerCss) {
    lines.push(
      `#${containerId} {`,
      `  container-type: inline-size;`,
      `  container-name: ${containerId};`,
      `}`,
    );
  }

  // fitMode: height — container fills height
  if (fitMode === "height") {
    lines.push(`#${containerId} { height: 100%; }`);
  }

  // fitMode: cover — container fills both dimensions
  if (fitMode === "cover") {
    lines.push(`#${containerId} { width: 100%; height: 100%; overflow: hidden; }`);
  }

  // maxWidth (ignored for cover mode)
  if (settings.maxWidth && fitMode !== "cover") {
    lines.push(`#${containerId} { max-width: ${settings.maxWidth}px; }`);
  }

  // centering: cover ignores, height applies horizontal only, width applies both
  if (settings.centerHtmlOutput && fitMode !== "cover") {
    lines.push(`#${containerId},`, `#${containerId} .${ns}artboard {`, `  margin: 0 auto;`, `}`);
  }

  // Base classes
  lines.push(`#${containerId} p { margin: 0; }`);
  if (settings.testingMode) {
    lines.push(`#${containerId} p { color: rgba(209,0,0,0.5) !important; }`);
  }
  lines.push(`#${containerId} .${ns}aiAbs { position: absolute; }`);
  if (cssVarImages) {
    const bgSize = fitMode === "cover" ? "cover" : fitMode === "height" ? "contain" : "100%";
    lines.push(
      `#${containerId} .${ns}aiImg { position: absolute; top: 0; display: block; width: 100% !important; height: 100%; background-size: ${bgSize}; background-position: center; }`,
    );
  } else {
    lines.push(
      `#${containerId} .${ns}aiImg { position: absolute; top: 0; display: block; width: 100% !important; }`,
    );
  }
  lines.push(`#${containerId} .${ns}aiPointText p { white-space: nowrap; }`);

  if (doc.metadata.altText) {
    lines.push(
      `#${containerId} .${ns}aiAltText {`,
      `  position: absolute; left: -10000px; width: 1px; height: 1px;`,
      `  overflow: hidden; white-space: nowrap;`,
      `}`,
    );
  }

  if (settings.clickableLink) {
    lines.push(`#${containerId} .${ns}ai2htmlLink { display: block; }`);
  }

  // Per-artboard CSS
  for (const ab of doc.artboards) {
    const abKey = makeArtboardKey(ab, doc.artboards);
    const abId = `${ns}${slug}-${abKey}`;
    const responsiveness = ab.responsiveness ?? doc.settings.responsiveness;
    if (responsiveness === "dynamic") {
      lines.push(
        `#${abId} { position: relative; overflow: hidden; aspect-ratio: ${ab.width} / ${ab.height}; }`,
      );
    } else {
      lines.push(`#${abId} { position: relative; overflow: hidden; }`);
    }

    // Base paragraph style
    if (ab.baseParagraphStyle) {
      lines.push(`#${abId} p {`, formatStyleRule(ab.baseParagraphStyle), `}`);
    }

    // Paragraph style classes
    for (const entry of ab.paragraphStyleClasses) {
      lines.push(`#${abId} .${entry.className} {`, formatStyleRule(entry.style), `}`);
    }

    // Character style classes
    for (const entry of ab.characterStyleClasses) {
      lines.push(`#${abId} .${entry.className} {`, formatStyleRule(entry.style), `}`);
    }

    // Effect style classes
    for (const entry of ab.effectStyleClasses) {
      lines.push(`#${abId} .${entry.className} { ${entry.css} }`);
    }
  }

  // Container query responsive rules
  if (hasMultipleArtboards && settings.includeResizerCss) {
    const sorted = [...doc.artboards].sort((a, b) => a.breakpoint.minWidth - b.breakpoint.minWidth);

    // Hide all except smallest by default
    for (let i = 1; i < sorted.length; i++) {
      const abId = `${ns}${slug}-${makeArtboardKey(sorted[i], doc.artboards)}`;
      lines.push(`#${abId} { display: none; }`);
    }

    // Smallest artboard: set background-image by default (visible without CQ)
    if (cssVarImages) {
      const smallestId = `${ns}${slug}-${makeArtboardKey(sorted[0], doc.artboards)}`;
      const smallestKeyword = makeArtboardKey(sorted[0], doc.artboards);
      lines.push(`#${smallestId} .${ns}aiImg { background-image: var(--${smallestKeyword}-img); }`);
    }

    for (let i = 0; i < sorted.length; i++) {
      const bp = sorted[i].breakpoint;
      const abId = `${ns}${slug}-${makeArtboardKey(sorted[i], doc.artboards)}`;
      const keyword = makeArtboardKey(sorted[i], doc.artboards);

      if (i === 0 && sorted.length > 1) {
        const nextMin = sorted[1].breakpoint.minWidth;
        lines.push(
          `@container ${containerId} (min-width: ${nextMin}px) {`,
          `  #${abId} { display: none; }`,
          `}`,
        );
      } else if (i === sorted.length - 1) {
        if (cssVarImages) {
          lines.push(
            `@container ${containerId} (min-width: ${bp.minWidth}px) {`,
            `  #${abId} { display: block; }`,
            `  #${abId} .${ns}aiImg { background-image: var(--${keyword}-img); }`,
            `}`,
          );
        } else {
          lines.push(
            `@container ${containerId} (min-width: ${bp.minWidth}px) {`,
            `  #${abId} { display: block; }`,
            `}`,
          );
        }
      } else {
        const nextMin = sorted[i + 1].breakpoint.minWidth;
        if (cssVarImages) {
          lines.push(
            `@container ${containerId} (min-width: ${bp.minWidth}px) and (max-width: ${nextMin - 1}px) {`,
            `  #${abId} { display: block; }`,
            `  #${abId} .${ns}aiImg { background-image: var(--${keyword}-img); }`,
            `}`,
          );
        } else {
          lines.push(
            `@container ${containerId} (min-width: ${bp.minWidth}px) and (max-width: ${nextMin - 1}px) {`,
            `  #${abId} { display: block; }`,
            `}`,
          );
        }
      }
    }
  }

  // Custom CSS blocks
  for (const block of doc.customBlocks) {
    if (block.type === "css") {
      lines.push(`/* Custom CSS */`, block.content);
    }
  }

  return { css: lines.join("\n"), warnings };
}
