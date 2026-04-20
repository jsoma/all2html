// CRITICAL: Keep output in sync with html-string.ts (the ExtendScript-compatible parallel emitter).
// Both must produce byte-identical output for the same input.
import type { Properties, Root, RootContent } from "hast";
import { toHtml } from "hast-util-to-html";
import type {
  ComputedPosition,
  EmitterReadyArtboard,
  EmitterReadyDocument,
  EmitterReadyShapeElement,
  EmitterReadyTextElement,
} from "../ir/types.js";
import {
  buildScopedAssetIndex,
  getScopedArtboardAsset,
  getScopedLayerAsset,
  resolveAssetPath,
  type ScopedAssetIndex,
  toCssUrlValue,
} from "./shared/assets.js";
import { generateCSS, makeArtboardKey, makeKeyword, useCssVarImages } from "./shared/css.js";
import { commentNode, escapeHtml, h, raw } from "./shared/hast-helpers.js";
import { applyEmitterOptions } from "./shared/options.js";
import type { EmitterOptions } from "./types.js";

export interface EmitHTMLResult {
  html: string;
  warnings: string[];
}

function isEmitterReadyText(el: { type: string }): el is EmitterReadyTextElement {
  return el.type === "text" && "computedPosition" in el;
}

function positionToStyleString(pos: ComputedPosition): string {
  const parts: string[] = [];
  if (pos.top) parts.push(`top:${pos.top}`);
  if (pos.bottom) parts.push(`bottom:${pos.bottom}`);
  if (pos.left) parts.push(`left:${pos.left}`);
  if (pos.right) parts.push(`right:${pos.right}`);
  if (pos.marginTop) parts.push(`margin-top:${pos.marginTop}`);
  if (pos.marginLeft) parts.push(`margin-left:${pos.marginLeft}`);
  parts.push(`width:${pos.width}`);
  if (pos.transform) parts.push(`transform:${pos.transform}`);
  if (pos.transformOrigin) parts.push(`transform-origin:${pos.transformOrigin}`);
  return parts.join(";");
}

function renderTextElement(
  el: EmitterReadyTextElement,
  ns: string,
  layerName: string,
): RootContent {
  const pos = el.computedPosition;
  const style = positionToStyleString(pos);

  const classes = [`${ns}${makeKeyword(layerName)}`, `${ns}aiAbs`];
  if (el.kind === "point") {
    classes.push(`${ns}aiPointText`);
  }
  if (el.effectClassName) {
    classes.push(el.effectClassName);
  }

  // Area text path styling
  const extraStyle: string[] = [];
  if (el.areaFill) {
    const { r, g: green, b } = el.areaFill;
    extraStyle.push(`background-color:rgb(${r},${green},${b})`);
    extraStyle.push("padding:6px 6px 6px 7px");
  }
  if (el.areaBorder) {
    const { r, g: green, b } = el.areaBorder.color;
    extraStyle.push(`border:1px solid rgb(${r},${green},${b})`);
    if (!el.areaFill) extraStyle.push("padding:6px 6px 6px 7px");
  }

  const fullStyle = [style, ...extraStyle].filter(Boolean).join(";");

  // Build paragraph children as hast nodes
  const children: RootContent[] = [];
  for (let pi = 0; pi < el.paragraphs.length; pi++) {
    const para = el.paragraphs[pi];
    const paraClassName = el.paragraphClassNames[pi];

    // Empty paragraph
    if (!para.text || para.text === "\r" || para.text === "\n") {
      const pProps: Properties = {};
      if (paraClassName) pProps.className = [paraClassName];
      children.push(h("p", pProps, [raw("&nbsp;")]));
      continue;
    }

    // Build runs
    const runChildren: RootContent[] = [];
    for (let ri = 0; ri < para.runs.length; ri++) {
      const run = para.runs[ri];
      const runClassName = el.runClassNames[pi]?.[ri];
      const text = escapeHtml(run.text);

      let runNode: RootContent;
      if (runClassName) {
        runNode = h("span", { className: [runClassName] }, [raw(text)]);
      } else {
        runNode = raw(text);
      }

      if (run.hyperlink) {
        const linkProps: Properties = { href: run.hyperlink.href };
        if (run.hyperlink.target) linkProps.target = run.hyperlink.target;
        runNode = h("a", linkProps, [runNode]);
      }

      runChildren.push(runNode);
    }

    const pProps: Properties = {};
    if (paraClassName) pProps.className = [paraClassName];
    children.push(h("p", pProps, runChildren));
  }

  const divProps: Properties = {
    id: el.id,
    className: classes,
    style: fullStyle,
  };

  // Mark bound text elements for framework emitter overlay rendering
  if (el.binding) {
    divProps["data-replaceable"] = "binding";
    divProps["data-binding-path"] = el.binding.path;
    if (el.binding.allowHtml) {
      divProps["data-binding-html"] = "true";
    }
  }

  return h("div", divProps, children);
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
): RootContent {
  const settings = doc.settings;
  const abKey = makeArtboardKey(ab, doc.artboards);
  const abId = `${ns}${slug}-${abKey}`;
  const responsiveness = ab.responsiveness ?? settings.responsiveness;
  const bp = ab.breakpoint;

  // Inline style
  const abStyleParts: string[] = [];
  if (responsiveness === "dynamic") {
    if (bp.widthRangeMin > 0) abStyleParts.push(`min-width:${bp.widthRangeMin}px`);
    if (bp.widthRangeMax < Infinity) abStyleParts.push(`max-width:${bp.widthRangeMax}px`);
  } else {
    abStyleParts.push(`width:${ab.width}px`);
    abStyleParts.push(`height:${ab.height}px`);
  }

  const abProps: Properties = {
    id: abId,
    className: [`${ns}artboard`],
    style: abStyleParts.join(";"),
    "data-aspect-ratio": (ab.width / ab.height).toFixed(3),
  };

  if (settings.includeResizerWidths) {
    abProps["data-min-width"] = String(bp.minWidth);
    if (bp.maxWidth < Infinity) {
      abProps["data-max-width"] = String(bp.maxWidth);
    }
  }

  const abChildren: RootContent[] = [];

  // Spacer div for dynamic artboards
  if (responsiveness === "dynamic") {
    const paddingPct = ((ab.height / ab.width) * 100).toFixed(4);
    abChildren.push(h("div", { style: `padding:0 0 ${paddingPct}% 0` }));
  }

  // Background image
  const bgAsset = getScopedArtboardAsset(assetIdx, ab);
  if (bgAsset) {
    if (cssVarImages) {
      // CSS custom property mode: use <div> with background-image via CSS var
      const divProps: Properties = {
        id: `${abId}-img`,
        className: [`${ns}aiImg`],
        role: "img",
        "aria-label": doc.metadata.imageAltText || ab.name,
      };
      abChildren.push(h("div", divProps));
    } else {
      const imgSrc = resolveAssetPath(bgAsset, settings);
      const imgProps: Properties = {
        id: `${abId}-img`,
        className: [`${ns}aiImg`],
        alt: doc.metadata.imageAltText || "",
        src: imgSrc,
      };
      if (settings.useLazyLoader) {
        imgProps.loading = "lazy";
      }
      abChildren.push(h("img", imgProps));
    }
  }

  // html-before layers
  for (const layer of ab.layers) {
    if (layer.type !== "html-before") continue;
    for (const el of layer.elements) {
      if (el.type === "rawHtml") abChildren.push(raw(el.content));
    }
  }

  // Render non-hook layers in the preserved layer order from the canonical artboard.
  for (const layer of ab.layers) {
    switch (layer.type) {
      case "png": {
        const pngAsset = getScopedLayerAsset(assetIdx, ab, layer.name);
        if (pngAsset) {
          const pngSrc = resolveAssetPath(pngAsset, settings);
          abChildren.push(
            h("img", {
              className: [`${ns}aiImg`],
              alt: "",
              src: pngSrc,
              style:
                layer.opacity < 100 ? `opacity:${(layer.opacity / 100).toFixed(2)}` : undefined,
            }),
          );
        }
        break;
      }
      case "svg": {
        if (layer.inlineSvg) {
          for (const el of layer.elements) {
            if (el.type === "rawHtml") {
              abChildren.push(raw(el.content));
            }
          }
        } else {
          const svgAsset = getScopedLayerAsset(assetIdx, ab, layer.name);
          if (svgAsset) {
            const svgSrc = resolveAssetPath(svgAsset, settings);
            abChildren.push(
              h("img", {
                className: [`${ns}aiImg`],
                alt: "",
                src: svgSrc,
                style:
                  layer.opacity < 100 ? `opacity:${(layer.opacity / 100).toFixed(2)}` : undefined,
              }),
            );
          }
        }
        break;
      }
      case "video":
        for (const el of layer.elements) {
          if (el.type === "video") {
            const videoAttrs: Properties = {
              autoplay: true,
              muted: true,
              loop: true,
              playsinline: true,
              style: "top:0;width:100%;object-fit:contain;position:absolute",
            };
            if (settings.useLazyLoader) {
              videoAttrs["data-src"] = el.url;
            } else {
              videoAttrs.src = el.url;
            }
            abChildren.push(h("video", videoAttrs));
          }
        }
        break;
      case "symbol":
      case "div": {
        const symbolChildren: RootContent[] = [];
        for (const el of layer.elements) {
          if (el.type === "shape" && "computedShapePosition" in el) {
            const sp = (el as EmitterReadyShapeElement).computedShapePosition;
            const styleParts: string[] = [];
            if (sp.left) styleParts.push(`left:${sp.left}`);
            if (sp.top) styleParts.push(`top:${sp.top}`);
            if (sp.marginLeft) styleParts.push(`margin-left:${sp.marginLeft}`);
            if (sp.marginTop) styleParts.push(`margin-top:${sp.marginTop}`);
            if (sp.width) styleParts.push(`width:${sp.width}`);
            if (sp.height) styleParts.push(`height:${sp.height}`);
            if (sp.borderRadius) styleParts.push(`border-radius:${sp.borderRadius}`);
            if (sp.backgroundColor) styleParts.push(`background-color:${sp.backgroundColor}`);
            if (sp.border) styleParts.push(`border:${sp.border}`);
            if (sp.borderTop) styleParts.push(`border-top:${sp.borderTop}`);
            if (sp.borderRight) styleParts.push(`border-right:${sp.borderRight}`);
            if (sp.opacity) styleParts.push(`opacity:${sp.opacity}`);
            if (sp.mixBlendMode) styleParts.push(`mix-blend-mode:${sp.mixBlendMode}`);

            const shapeProps: Properties = {
              className: [`${ns}aiSymbol`],
              style: styleParts.join(";"),
            };
            if (el.id) {
              shapeProps["data-name"] = el.id;
            }
            symbolChildren.push(h("div", shapeProps));
          }
        }
        if (symbolChildren.length > 0) {
          abChildren.push(
            h(
              "div",
              { className: [`${ns}symbol-layer`, `${ns}${makeKeyword(layer.name)}`] },
              symbolChildren,
            ),
          );
        }
        break;
      }
      case "default":
        for (const el of layer.elements) {
          if (isEmitterReadyText(el) && el.renderAs === "html") {
            abChildren.push(renderTextElement(el, ns, layer.name));
          }
          if (el.type === "snippet" && "computedPosition" in el) {
            const snippetStyle = positionToStyleString(el.computedPosition);
            abChildren.push(
              h("div", {
                className: [`${ns}aiAbs`],
                "data-replaceable": "snippet",
                "data-key": el.key,
                style: snippetStyle,
              }),
            );
          }
          if (el.type === "rawHtml") {
            abChildren.push(raw(el.content));
          }
        }
        break;
    }
  }

  // html-after layers
  for (const layer of ab.layers) {
    if (layer.type !== "html-after") continue;
    for (const el of layer.elements) {
      if (el.type === "rawHtml") abChildren.push(raw(el.content));
    }
  }

  return h("div", abProps, abChildren);
}

export interface EmitGroupOptions {
  /** Override which artboards to include */
  artboards?: EmitterReadyArtboard[];
  /** Override the slug used for IDs and naming */
  slug?: string;
}

export function emitHTML(
  doc: EmitterReadyDocument,
  groupOptions?: EmitGroupOptions,
  options?: EmitterOptions,
): EmitHTMLResult {
  const warnings: string[] = [];
  const resolvedDoc = applyEmitterOptions(doc, options);
  const settings = resolvedDoc.settings;
  const ns = settings.namespace;
  const slug = groupOptions?.slug || settings.projectName || doc.metadata.slug;
  const containerId = `${ns}${slug}-box`;

  // If group options provided, create a scoped document view
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

  // Build hast tree
  const rootChildren: RootContent[] = [];

  // Comments
  rootChildren.push(commentNode("Generated by all2html"));
  rootChildren.push(commentNode(`source: ${slug}`));
  rootChildren.push(raw("\n"));

  // Style block
  rootChildren.push(h("style", { media: "screen,print" }, [raw(`\n${css}\n`)]));
  rootChildren.push(raw("\n"));

  // Container div
  const containerProps: Properties = {
    id: containerId,
    className: ["ai2html"],
  };
  if (doc.metadata.ariaRole) {
    containerProps.role = doc.metadata.ariaRole;
  }
  const altTextId = `${containerId}-img-desc`;
  if (doc.metadata.altText) {
    containerProps["aria-describedby"] = altTextId;
  }

  // Build asset index for O(1) lookups (used for both CSS vars and artboard rendering)
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
        varParts.push(`--${keyword}-img:${toCssUrlValue(imgSrc)}`);
      }
    }
    if (varParts.length > 0) {
      containerProps.style = varParts.join(";");
    }
  }

  const containerChildren: RootContent[] = [];

  // Alt text
  if (resolvedDoc.metadata.altText) {
    containerChildren.push(
      h("div", { className: [`${ns}aiAltText`], id: altTextId }, [resolvedDoc.metadata.altText]),
    );
  }

  // Clickable link open
  let linkChildren: RootContent[] | null = null;
  if (settings.clickableLink) {
    linkChildren = [];
  }
  const target = linkChildren ?? containerChildren;

  // Custom HTML before
  for (const block of resolvedDoc.customBlocks) {
    if (block.type === "html-before") {
      target.push(raw(block.content));
    }
  }

  // Artboards (sorted by breakpoint)
  const sortedAbs = [...scopedDoc.artboards].sort(
    (a, b) => a.breakpoint.minWidth - b.breakpoint.minWidth,
  );
  for (const ab of sortedAbs) {
    target.push(
      commentNode(`Artboard: ${ab.name}`),
      renderArtboard(ab, resolvedDoc, ns, slug, assetIdx, cssVarMode),
    );
  }

  // Custom HTML after
  for (const block of resolvedDoc.customBlocks) {
    if (block.type === "html-after" || block.type === "html") {
      target.push(raw(block.content));
    }
  }

  // Close link wrapper if needed
  if (linkChildren) {
    containerChildren.push(
      h("a", { className: [`${ns}ai2htmlLink`], href: settings.clickableLink }, linkChildren),
    );
  }

  rootChildren.push(h("div", containerProps, containerChildren));

  // Custom JS
  for (const block of resolvedDoc.customBlocks) {
    if (block.type === "js") {
      rootChildren.push(h("script", { type: "text/javascript" }, [raw(block.content)]));
    }
  }

  rootChildren.push(raw("\n"));
  rootChildren.push(commentNode("End all2html"));

  const tree: Root = { type: "root", children: rootChildren };
  const html = toHtml(tree, {
    allowDangerousHtml: true,
    characterReferences: { useNamedReferences: true },
  });

  return { html, warnings };
}
