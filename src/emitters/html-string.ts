// CRITICAL: Keep output in sync with html.ts (the hast-based emitter).
// Both must produce byte-identical output for the same input.
/**
 * String-based HTML emitter — produces identical output to the hast emitter
 * but with no npm dependencies. Used in the ExtendScript bundle.
 */
import type {
  ComputedPosition,
  EmitterReadyArtboard,
  EmitterReadyDocument,
  EmitterReadyTextElement,
} from "../ir/types.js";
import type { EmitterOptions } from "./types.js";
import {
  buildScopedAssetIndex,
  getScopedArtboardAsset,
  getScopedLayerAsset,
  resolveAssetPath,
  toCssUrlValue,
  type ScopedAssetIndex,
} from "./shared/assets.js";
import { generateCSS, makeArtboardKey, makeKeyword, useCssVarImages } from "./shared/css.js";
import { applyEmitterOptions } from "./shared/options.js";

export interface EmitHTMLResult {
  html: string;
  warnings: string[];
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isEmitterReadyText(el: { type: string }): el is EmitterReadyTextElement {
  return el.type === "text" && "computedPosition" in el;
}

function positionToStyleString(pos: ComputedPosition): string {
  const parts: string[] = [];
  if (pos.top) parts.push("top:" + pos.top);
  if (pos.bottom) parts.push("bottom:" + pos.bottom);
  if (pos.left) parts.push("left:" + pos.left);
  if (pos.right) parts.push("right:" + pos.right);
  if (pos.marginTop) parts.push("margin-top:" + pos.marginTop);
  if (pos.marginLeft) parts.push("margin-left:" + pos.marginLeft);
  parts.push("width:" + pos.width);
  if (pos.transform) parts.push("transform:" + pos.transform);
  if (pos.transformOrigin) parts.push("transform-origin:" + pos.transformOrigin);
  return parts.join(";");
}

function attrsToString(attrs: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const key of Object.keys(attrs)) {
    const val = attrs[key];
    if (val !== undefined) {
      parts.push(key + '="' + val + '"');
    }
  }
  return parts.join(" ");
}

function renderTextElement(el: EmitterReadyTextElement, ns: string, layerName: string): string {
  const pos = el.computedPosition;
  const style = positionToStyleString(pos);

  const classes = [ns + makeKeyword(layerName), ns + "aiAbs"];
  if (el.kind === "point") {
    classes.push(ns + "aiPointText");
  }
  if (el.effectClassName) {
    classes.push(el.effectClassName);
  }

  const extraStyle: string[] = [];
  if (el.areaFill) {
    const c = el.areaFill;
    extraStyle.push("background-color:rgb(" + c.r + "," + c.g + "," + c.b + ")");
    extraStyle.push("padding:6px 6px 6px 7px");
  }
  if (el.areaBorder) {
    const c = el.areaBorder.color;
    extraStyle.push("border:1px solid rgb(" + c.r + "," + c.g + "," + c.b + ")");
    if (!el.areaFill) extraStyle.push("padding:6px 6px 6px 7px");
  }

  const fullStyle = [style].concat(extraStyle).filter(Boolean).join(";");

  // Build paragraphs
  const pHtmlParts: string[] = [];
  for (let pi = 0; pi < el.paragraphs.length; pi++) {
    const para = el.paragraphs[pi];
    const paraClassName = el.paragraphClassNames[pi];

    if (!para.text || para.text === "\r" || para.text === "\n") {
      if (paraClassName) {
        pHtmlParts.push('<p class="' + paraClassName + '">&nbsp;</p>');
      } else {
        pHtmlParts.push("<p>&nbsp;</p>");
      }
      continue;
    }

    // Build run content
    let runHtml = "";
    for (let ri = 0; ri < para.runs.length; ri++) {
      const run = para.runs[ri];
      const runClassName = el.runClassNames[pi] ? el.runClassNames[pi][ri] : null;
      const text = escapeHtml(run.text);
      let runContent: string;
      if (runClassName) {
        runContent = '<span class="' + runClassName + '">' + text + "</span>";
      } else {
        runContent = text;
      }
      if (run.hyperlink) {
        const targetAttr = run.hyperlink.target
          ? ' target="' + escapeAttr(run.hyperlink.target) + '"'
          : "";
        runContent =
          '<a href="' + escapeAttr(run.hyperlink.href) + '"' + targetAttr + ">" + runContent + "</a>";
      }
      runHtml += runContent;
    }

    if (paraClassName) {
      pHtmlParts.push('<p class="' + paraClassName + '">' + runHtml + "</p>");
    } else {
      pHtmlParts.push("<p>" + runHtml + "</p>");
    }
  }

  // Mark bound text elements for framework emitter overlay rendering
  let bindingAttrs = "";
  if (el.binding) {
    bindingAttrs = ' data-replaceable="binding" data-binding-path="' + escapeAttr(el.binding.path) + '"';
    if (el.binding.allowHtml) {
      bindingAttrs += ' data-binding-html="true"';
    }
  }

  return (
    '<div id="' +
    escapeAttr(el.id) +
    '" class="' +
    classes.join(" ") +
    '" style="' +
    fullStyle +
    '"' +
    bindingAttrs +
    ">" +
    pHtmlParts.join("") +
    "</div>"
  );
}

function scopeArtboards(
  doc: EmitterReadyDocument,
  artboards?: EmitterReadyArtboard[],
): EmitterReadyArtboard[] {
  if (!artboards) return doc.artboards;
  const keys = new Set(artboards.map((ab) => `${ab.name}\u0000${ab.width}\u0000${ab.height}`));
  return doc.artboards.filter((ab) => keys.has(`${ab.name}\u0000${ab.width}\u0000${ab.height}`));
}

function renderArtboard(
  ab: EmitterReadyArtboard,
  doc: EmitterReadyDocument,
  ns: string,
  slug: string,
  assetIdx: ScopedAssetIndex,
  cssVarImages: boolean,
): string {
  const settings = doc.settings;
  const abId = ns + slug + "-" + makeArtboardKey(ab, doc.artboards);
  const responsiveness = ab.responsiveness ?? settings.responsiveness;
  const bp = ab.breakpoint;

  const abStyleParts: string[] = [];
  if (responsiveness === "dynamic") {
    if (bp.widthRangeMin > 0) abStyleParts.push("min-width:" + bp.widthRangeMin + "px");
    if (bp.widthRangeMax < Infinity) abStyleParts.push("max-width:" + bp.widthRangeMax + "px");
  } else {
    abStyleParts.push("width:" + ab.width + "px");
    abStyleParts.push("height:" + ab.height + "px");
  }

  const attrs: Record<string, string | undefined> = {
    id: abId,
    "class": ns + "artboard",
    style: abStyleParts.join(";"),
    "data-aspect-ratio": (ab.width / ab.height).toFixed(3),
  };

  if (settings.includeResizerWidths) {
    attrs["data-min-width"] = String(bp.minWidth);
    if (bp.maxWidth < Infinity) {
      attrs["data-max-width"] = String(bp.maxWidth);
    }
  }

  let inner = "";

  // Spacer div
  if (responsiveness === "dynamic") {
    const paddingPct = ((ab.height / ab.width) * 100).toFixed(4);
    inner += '<div style="padding:0 0 ' + paddingPct + '% 0"></div>';
  }

  // Background image
  const bgAsset = getScopedArtboardAsset(assetIdx, ab);
  if (bgAsset) {
    if (cssVarImages) {
      // CSS custom property mode: use <div> with background-image via CSS var
      const divAttrs: Record<string, string | undefined> = {
        id: abId + "-img",
        "class": ns + "aiImg",
        role: "img",
        "aria-label": doc.metadata.imageAltText ? escapeAttr(doc.metadata.imageAltText) : escapeAttr(ab.name),
      };
      inner += "<div " + attrsToString(divAttrs) + "></div>";
    } else {
      const imgSrc = resolveAssetPath(bgAsset, settings);
      const imgAttrs: Record<string, string | undefined> = {
        id: abId + "-img",
        "class": ns + "aiImg",
        alt: doc.metadata.imageAltText ? escapeAttr(doc.metadata.imageAltText) : "",
        src: escapeAttr(imgSrc),
      };
      if (settings.useLazyLoader) {
        imgAttrs.loading = "lazy";
      }
      inner += "<img " + attrsToString(imgAttrs) + ">";
    }
  }

  // html-before layers
  for (const layer of ab.layers) {
    if (layer.type !== "html-before") continue;
    for (const el of layer.elements) {
      if (el.type === "rawHtml") inner += el.content;
    }
  }

  // Render non-hook layers in the preserved layer order from the canonical artboard.
  for (const layer of ab.layers) {
    switch (layer.type) {
      case "png": {
        const pngAsset = getScopedLayerAsset(assetIdx, ab, layer.name);
        if (pngAsset) {
          const pngSrc = resolveAssetPath(pngAsset, settings);
          const opacityStyle =
            layer.opacity < 100 ? ' style="opacity:' + (layer.opacity / 100).toFixed(2) + '"' : "";
          inner +=
            '<img class="' + ns + 'aiImg" alt="" src="' + escapeAttr(pngSrc) + '"' + opacityStyle + ">";
        }
        break;
      }
      case "svg":
        if (layer.inlineSvg) {
          for (const el of layer.elements) {
            if (el.type === "rawHtml") inner += el.content;
          }
        } else {
          const svgAsset = getScopedLayerAsset(assetIdx, ab, layer.name);
          if (svgAsset) {
            const svgSrc = resolveAssetPath(svgAsset, settings);
            const opacityStyle =
              layer.opacity < 100 ? ' style="opacity:' + (layer.opacity / 100).toFixed(2) + '"' : "";
            inner +=
              '<img class="' +
              ns +
              'aiImg" alt="" src="' +
              escapeAttr(svgSrc) +
              '"' +
              opacityStyle +
              ">";
          }
        }
        break;
      case "video":
        for (const el of layer.elements) {
          if (el.type === "video") {
            const srcAttr = settings.useLazyLoader
              ? ' data-src="' + escapeAttr(el.url) + '"'
              : ' src="' + escapeAttr(el.url) + '"';
            inner +=
              '<video autoplay muted loop playsinline style="top:0;width:100%;object-fit:contain;position:absolute"' +
              srcAttr +
              "></video>";
          }
        }
        break;
      case "symbol":
      case "div": {
        let symbolHtml = "";
        for (const el of layer.elements) {
          if (el.type === "shape" && "computedShapePosition" in el) {
            const sp = (el as import("../ir/types.js").EmitterReadyShapeElement).computedShapePosition;
            const parts: string[] = [];
            if (sp.left) parts.push("left:" + sp.left);
            if (sp.top) parts.push("top:" + sp.top);
            if (sp.marginLeft) parts.push("margin-left:" + sp.marginLeft);
            if (sp.marginTop) parts.push("margin-top:" + sp.marginTop);
            if (sp.width) parts.push("width:" + sp.width);
            if (sp.height) parts.push("height:" + sp.height);
            if (sp.borderRadius) parts.push("border-radius:" + sp.borderRadius);
            if (sp.backgroundColor) parts.push("background-color:" + sp.backgroundColor);
            if (sp.border) parts.push("border:" + sp.border);
            if (sp.borderTop) parts.push("border-top:" + sp.borderTop);
            if (sp.borderRight) parts.push("border-right:" + sp.borderRight);
            if (sp.opacity) parts.push("opacity:" + sp.opacity);
            if (sp.mixBlendMode) parts.push("mix-blend-mode:" + sp.mixBlendMode);
            const dataName = el.id ? ' data-name="' + escapeAttr(el.id) + '"' : "";
            symbolHtml +=
              '<div class="' + ns + 'aiSymbol" style="' + parts.join(";") + '"' + dataName + "></div>";
          }
        }
        if (symbolHtml) {
          inner +=
            '<div class="' +
            ns +
            "symbol-layer " +
            ns +
            makeKeyword(layer.name) +
            '">' +
            symbolHtml +
            "</div>";
        }
        break;
      }
      case "default":
        for (const el of layer.elements) {
          if (isEmitterReadyText(el) && el.renderAs === "html") {
            inner += renderTextElement(el, ns, layer.name);
          }
          if (el.type === "snippet" && "computedPosition" in el) {
            const snippetStyle = positionToStyleString(el.computedPosition);
            inner +=
              '<div class="' +
              ns +
              'aiAbs" data-replaceable="snippet" data-key="' +
              escapeAttr(el.key) +
              '" style="' +
              snippetStyle +
              '"></div>';
          }
          if (el.type === "rawHtml") inner += el.content;
        }
        break;
    }
  }

  // html-after layers
  for (const layer of ab.layers) {
    if (layer.type !== "html-after") continue;
    for (const el of layer.elements) {
      if (el.type === "rawHtml") inner += el.content;
    }
  }

  return "<div " + attrsToString(attrs) + ">" + inner + "</div>";
}

export interface EmitGroupOptions {
  artboards?: import("../ir/types.js").EmitterReadyArtboard[];
  slug?: string;
}

export function emitHTMLString(
  doc: EmitterReadyDocument,
  groupOptions?: EmitGroupOptions,
  options?: EmitterOptions,
): EmitHTMLResult {
  const warnings: string[] = [];
  const resolvedDoc = applyEmitterOptions(doc, options);
  const settings = resolvedDoc.settings;
  const ns = settings.namespace;
  const slug = groupOptions?.slug || settings.projectName || doc.metadata.slug;
  const containerId = ns + slug + "-box";

  const scopedDoc = {
    ...resolvedDoc,
    artboards: scopeArtboards(resolvedDoc, groupOptions?.artboards),
  };
  const cssVarMode = useCssVarImages(scopedDoc, options?.responsiveImageMode);

  const { css, warnings: cssWarnings } = generateCSS(scopedDoc, {
    slug,
    responsiveImageMode: options?.responsiveImageMode,
  });
  warnings.push(...cssWarnings);

  const parts: string[] = [];

  // Comments
  parts.push("<!-- Generated by all2html --><!-- source: " + slug + " -->");

  // Style block
  parts.push('\n<style media="screen,print">\n' + css + "\n</style>\n");

  // Container
  const containerAttrs: string[] = [];
  containerAttrs.push('id="' + containerId + '"');
  containerAttrs.push('class="ai2html"');
  if (resolvedDoc.metadata.ariaRole) {
    containerAttrs.push('role="' + escapeAttr(resolvedDoc.metadata.ariaRole) + '"');
  }
  const altTextId = containerId + "-img-desc";
  if (resolvedDoc.metadata.altText) {
    containerAttrs.push('aria-describedby="' + altTextId + '"');
  }

  // Build asset index for O(1) lookups
  const assetIdx = buildScopedAssetIndex(resolvedDoc.artboards, resolvedDoc.assets);

  // CSS custom property image loading: set image URLs as CSS vars on container
  if (cssVarMode) {
    const varParts: string[] = [];
    const sortedForVars = [...scopedDoc.artboards].sort(
      (a, b) => a.breakpoint.minWidth - b.breakpoint.minWidth,
    );
    for (const ab of sortedForVars) {
      const bgAsset = getScopedArtboardAsset(assetIdx, ab);
      if (bgAsset) {
        const keyword = makeArtboardKey(ab, scopedDoc.artboards);
        const imgSrc = resolveAssetPath(bgAsset, settings);
        varParts.push("--" + keyword + "-img:" + toCssUrlValue(imgSrc));
      }
    }
    if (varParts.length > 0) {
      containerAttrs.push('style="' + escapeAttr(varParts.join(";")) + '"');
    }
  }

  let containerInner = "";

  // Alt text
  if (resolvedDoc.metadata.altText) {
    containerInner +=
      '<div class="' +
      ns +
      'aiAltText" id="' +
      altTextId +
      '">' +
      escapeHtml(resolvedDoc.metadata.altText) +
      "</div>";
  }

  // Clickable link
  let linkInner = "";
  const useLink = Boolean(settings.clickableLink);

  // Custom HTML before
  for (const block of resolvedDoc.customBlocks) {
    if (block.type === "html-before") {
      if (useLink) linkInner += block.content;
      else containerInner += block.content;
    }
  }

  // Artboards
  const sorted = [...scopedDoc.artboards].sort(
    (a, b) => a.breakpoint.minWidth - b.breakpoint.minWidth,
  );
  for (const ab of sorted) {
    const abHtml =
      "<!-- Artboard: " +
      ab.name.replace(/-->/g, "- ->") +
      " -->" +
      renderArtboard(ab, resolvedDoc, ns, slug, assetIdx, cssVarMode);
    if (useLink) linkInner += abHtml;
    else containerInner += abHtml;
  }

  // Custom HTML after
  for (const block of resolvedDoc.customBlocks) {
    if (block.type === "html-after" || block.type === "html") {
      if (useLink) linkInner += block.content;
      else containerInner += block.content;
    }
  }

  // Wrap in link if needed
  if (useLink) {
    containerInner +=
      '<a class="' +
      ns +
      'ai2htmlLink" href="' +
      escapeAttr(settings.clickableLink) +
      '">' +
      linkInner +
      "</a>";
  }

  parts.push("<div " + containerAttrs.join(" ") + ">" + containerInner + "</div>");

  // Custom JS
  for (const block of resolvedDoc.customBlocks) {
    if (block.type === "js") {
      parts.push('<script type="text/javascript">' + block.content + "</script>");
    }
  }

  parts.push("\n<!-- End all2html -->");

  return { html: parts.join(""), warnings };
}
