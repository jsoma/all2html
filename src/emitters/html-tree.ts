/**
 * The one HTML emitter (SPEC §12.6 / decision D23).
 *
 * This module builds a tree of plain, JSON-serializable nodes
 * (`shared/html-node.ts`) and knows nothing about how they are rendered.
 * `html.ts` is a thin named entry point onto it.
 * `shared/to-hast.ts` adapts the same tree to hast, but only in-repo — see that
 * file's header; it is the serializer's parity oracle, not a published seam.
 *
 * **Builders pass RAW values.** Every escaping decision belongs to the
 * serializer, which picks the grammar from the node's position in the tree.
 * There is no `escapeAttr`/`escapeHtml` call anywhere in this file, and there
 * must not be one: pre-escaping here would double-escape at emit time.
 *
 * ES3-safe: this module ships inside the ExtendScript bundle.
 */

import { formatCssColor } from "../core/css-color.js";
import { hasOwn, opaqueKey } from "../core/identifiers.js";
import {
  createWarning,
  pushUniqueStructuredWarning,
  type StructuredWarning,
  warningMessages,
} from "../core/warnings.js";
import type {
  ComputedPosition,
  EmitterReadyArtboard,
  EmitterReadyDocument,
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
import { isSafeUrl, unsafeUrlWarning } from "./shared/escape.js";
import { renderGoogleFontsLinkTags } from "./shared/google-fonts.js";
import {
  comment,
  el,
  type HtmlAttrs,
  type HtmlNode,
  raw,
  serializeHtml,
  text,
} from "./shared/html-node.js";
import {
  LAZY_VIDEO_SCRIPT_ATTR,
  LAZY_VIDEO_SCRIPT_ATTR_VALUE,
  lazyVideoLoaderScript,
} from "./shared/lazy-video.js";
import { applyEmitterOptions } from "./shared/options.js";
import type { EmitterOptions } from "./types.js";

/** Stable code for a hyperlink or clickable-link URL rejected by the scheme allowlist. */
const UNSAFE_URL_CODE = "emit:unsafe-url";

export interface EmitHTMLResult {
  html: string;
  /** Plain-string projection of `structuredWarnings`, for consumers that want text. */
  warnings: string[];
  structuredWarnings: StructuredWarning[];
}

export interface EmitHTMLTreeResult {
  /** The serializable node tree. Render with `serializeHtml()` or `toHast()`. */
  nodes: HtmlNode[];
  structuredWarnings: StructuredWarning[];
  /**
   * How many `<video data-src>` elements the tree carries. Non-zero means the
   * tree also carries the loader `<script>`; the framework emitters read it to
   * decide whether to emit a lifecycle effect in its place.
   */
  lazyVideoCount: number;
}

/** Mutable per-build tallies. Emitter-local — never part of the document. */
interface RenderTally {
  lazyVideos: number;
}

export interface EmitGroupOptions {
  /** Override which artboards to include */
  artboards?: EmitterReadyArtboard[];
  /** Override the slug used for IDs and naming */
  slug?: string;
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

function renderTextElement(
  element: EmitterReadyTextElement,
  ns: string,
  idPrefix: string,
  layerName: string,
  warnings: StructuredWarning[],
): HtmlNode {
  const style = positionToStyleString(element.computedPosition);

  const classes = [ns + makeKeyword(layerName), ns + "aiAbs"];
  if (element.kind === "point") {
    classes.push(ns + "aiPointText");
  }
  if (element.effectClassName) {
    classes.push(element.effectClassName);
  }

  // Area text path styling. Colors go through the one formatter (alpha as
  // rgba, no near-black snap); the border width is the declared IR width,
  // rounded like shape strokes.
  const extraStyle: string[] = [];
  if (element.areaFill) {
    extraStyle.push("background-color:" + formatCssColor(element.areaFill));
    extraStyle.push("padding:6px 6px 6px 7px");
  }
  if (element.areaBorder) {
    const borderWidth = Math.max(1, Math.round(element.areaBorder.width));
    extraStyle.push(
      "border:" + borderWidth + "px solid " + formatCssColor(element.areaBorder.color),
    );
    if (!element.areaFill) extraStyle.push("padding:6px 6px 6px 7px");
  }

  const fullStyle = [style].concat(extraStyle).filter(Boolean).join(";");

  const paragraphs: HtmlNode[] = [];
  for (let pi = 0; pi < element.paragraphs.length; pi++) {
    const para = element.paragraphs[pi];
    const paraClassName = element.paragraphClassNames[pi];
    const paraAttrs: HtmlAttrs = paraClassName ? [["class", paraClassName]] : [];

    // Empty paragraph. `&nbsp;` is deliberate markup, not text content — a text
    // node would escape the ampersand.
    if (!para.text || para.text === "\r" || para.text === "\n") {
      paragraphs.push(el("p", paraAttrs, [raw("&nbsp;")]));
      continue;
    }

    const runs: HtmlNode[] = [];
    for (let ri = 0; ri < para.runs.length; ri++) {
      const run = para.runs[ri];
      const runClassName = element.runClassNames[pi] ? element.runClassNames[pi][ri] : null;

      let runNode: HtmlNode = text(run.text);
      if (runClassName) {
        runNode = el("span", [["class", runClassName]], [runNode]);
      }

      if (run.hyperlink) {
        if (isSafeUrl(run.hyperlink.href)) {
          const linkAttrs: HtmlAttrs = [["href", run.hyperlink.href]];
          if (run.hyperlink.target) linkAttrs.push(["target", run.hyperlink.target]);
          runNode = el("a", linkAttrs, [runNode]);
        } else {
          // Drop the anchor rather than emit an unusable one; the run text stays.
          pushUniqueStructuredWarning(
            warnings,
            createWarning(
              UNSAFE_URL_CODE,
              "markup",
              unsafeUrlWarning("text hyperlink", run.hyperlink.href),
            ),
          );
        }
      }

      runs.push(runNode);
    }

    paragraphs.push(el("p", paraAttrs, runs));
  }

  // Element ids are namespaced with the emitted artboard id — `{ns}{slug}-` plus
  // the artboard key (D7, spec §2.7). Exporters mint document-local ids —
  // Illustrator's are literally `g-ai0-1`, and a *named* frame emits its name —
  // so two all2html graphics on one CMS page, or two artboards in one responsive
  // group each holding a frame named `headline`, would otherwise emit duplicate
  // ids. Nothing in the generated CSS selects an element id (see
  // `shared/css.ts`: only the container and artboard ids appear in selectors),
  // so this is an emit-time rename with no stylesheet counterpart to keep in
  // sync.
  const attrs: HtmlAttrs = [
    ["id", idPrefix + element.id],
    ["class", classes.join(" ")],
    ["style", fullStyle],
  ];

  // Mark bound text elements for framework emitter overlay rendering
  if (element.binding) {
    attrs.push(["data-replaceable", "binding"]);
    attrs.push(["data-binding-path", element.binding.path]);
    if (element.binding.allowHtml) {
      attrs.push(["data-binding-html", "true"]);
    }
  }

  return el("div", attrs, paragraphs);
}

function scopeArtboards(
  doc: EmitterReadyDocument,
  artboards?: EmitterReadyArtboard[],
): EmitterReadyArtboard[] {
  if (!artboards) return doc.artboards;
  // `opaqueKey()`/`hasOwn()` (src/core/identifiers.js): an artboard whose id is
  // `__proto__` must be scoped like any other, not silently dropped.
  const ids: Record<string, true> = {};
  for (const ab of artboards) {
    ids[opaqueKey(ab.id)] = true;
  }
  return doc.artboards.filter((ab) => hasOwn(ids, opaqueKey(ab.id)));
}

function renderArtboard(
  ab: EmitterReadyArtboard,
  doc: EmitterReadyDocument,
  ns: string,
  slug: string,
  assetIdx: ScopedAssetIndex,
  cssVarImages: boolean,
  assetBase: string,
  warnings: StructuredWarning[],
  tally: RenderTally,
): HtmlNode {
  const settings = doc.settings;
  const idPrefix = ns + slug + "-";
  const abId = idPrefix + makeArtboardKey(ab, doc.artboards);
  const responsiveness = ab.responsiveness ?? settings.responsiveness;
  const bp = ab.breakpoint;

  const abStyleParts: string[] = [];
  if (responsiveness === "dynamic") {
    if (bp.widthRangeMin > 0) abStyleParts.push("min-width:" + bp.widthRangeMin + "px");
    if (bp.widthRangeMax !== undefined) abStyleParts.push("max-width:" + bp.widthRangeMax + "px");
  } else {
    abStyleParts.push("width:" + ab.width + "px");
    abStyleParts.push("height:" + ab.height + "px");
  }

  const abAttrs: HtmlAttrs = [
    ["id", abId],
    ["class", ns + "artboard"],
    ["style", abStyleParts.join(";")],
    ["data-aspect-ratio", (ab.width / ab.height).toFixed(3)],
  ];

  if (settings.includeResizerWidths) {
    abAttrs.push(["data-min-width", String(bp.minWidth)]);
    if (bp.maxWidth !== undefined) {
      abAttrs.push(["data-max-width", String(bp.maxWidth)]);
    }
  }

  const children: HtmlNode[] = [];

  // Spacer div for dynamic artboards
  if (responsiveness === "dynamic") {
    const paddingPct = ((ab.height / ab.width) * 100).toFixed(4);
    children.push(el("div", [["style", "padding:0 0 " + paddingPct + "% 0"]]));
  }

  // Background image
  const bgAsset = getScopedArtboardAsset(assetIdx, ab);
  if (bgAsset) {
    // The asset's own description wins over the document-level one. Two
    // rasterized artboards in one document describe two different graphics, and
    // `metadata.imageAltText` can only hold one of them; it stays as the
    // document-level fallback because that is what Illustrator's settings block
    // and the Figma UI set.
    const bgAltText = bgAsset.altText || doc.metadata.imageAltText || "";
    if (cssVarImages) {
      // CSS custom property mode: use <div> with background-image via CSS var
      children.push(
        el("div", [
          ["id", abId + "-img"],
          ["class", ns + "aiImg"],
          ["role", "img"],
          ["aria-label", bgAltText || ab.name],
        ]),
      );
    } else {
      const imgAttrs: HtmlAttrs = [
        ["id", abId + "-img"],
        ["class", ns + "aiImg"],
        ["alt", bgAltText],
        ["src", resolveAssetPath(bgAsset, settings, assetBase, warnings)],
      ];
      if (settings.useLazyLoader) {
        imgAttrs.push(["loading", "lazy"]);
      }
      children.push(el("img", imgAttrs));
    }
  }

  // html-before layers. Invisible layers are skipped here like everywhere
  // else — a hook layer the designer hid must not inject markup.
  for (const layer of ab.layers) {
    if (layer.type !== "html-before") continue;
    if (layer.visible === false) continue;
    for (const element of layer.elements) {
      if (element.type === "rawHtml") children.push(raw(element.content));
    }
  }

  // Render non-hook layers in the preserved layer order from the canonical artboard.
  // A `visible: false` layer produces nothing, whatever its kind (asset layers
  // included): visibility is authored state, and rendering hidden content was a
  // silent divergence from the design tool.
  for (const layer of ab.layers) {
    if (layer.visible === false) continue;
    switch (layer.type) {
      case "png": {
        const pngAsset = getScopedLayerAsset(assetIdx, ab, layer.id);
        if (pngAsset) {
          children.push(
            el("img", [
              ["class", ns + "aiImg"],
              ["alt", ""],
              ["src", resolveAssetPath(pngAsset, settings, assetBase, warnings)],
              [
                "style",
                layer.opacity < 100 ? "opacity:" + (layer.opacity / 100).toFixed(2) : undefined,
              ],
            ]),
          );
        }
        break;
      }
      case "svg": {
        if (layer.inlineSvg) {
          for (const element of layer.elements) {
            if (element.type === "rawHtml") children.push(raw(element.content));
          }
        } else {
          const svgAsset = getScopedLayerAsset(assetIdx, ab, layer.id);
          if (svgAsset) {
            children.push(
              el("img", [
                ["class", ns + "aiImg"],
                ["alt", ""],
                ["src", resolveAssetPath(svgAsset, settings, assetBase, warnings)],
                [
                  "style",
                  layer.opacity < 100 ? "opacity:" + (layer.opacity / 100).toFixed(2) : undefined,
                ],
              ]),
            );
          }
        }
        break;
      }
      case "video":
        for (const element of layer.elements) {
          if (element.type === "video") {
            if (settings.useLazyLoader) {
              tally.lazyVideos++;
            }
            children.push(
              el("video", [
                ["autoplay", true],
                ["muted", true],
                ["loop", true],
                ["playsinline", true],
                ["style", "top:0;width:100%;object-fit:contain;position:absolute"],
                [settings.useLazyLoader ? "data-src" : "src", element.url],
              ]),
            );
          }
        }
        break;
      case "symbol":
      case "div": {
        const shapes: HtmlNode[] = [];
        for (const element of layer.elements) {
          if (element.type === "shape") {
            const sp = element.computedShapePosition;
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

            const shapeAttrs: HtmlAttrs = [
              ["class", ns + "aiSymbol"],
              ["style", parts.join(";")],
            ];
            if (element.id) {
              shapeAttrs.push(["data-name", element.id]);
            }
            shapes.push(el("div", shapeAttrs));
          }
        }
        if (shapes.length > 0) {
          children.push(
            el("div", [["class", ns + "symbol-layer " + ns + makeKeyword(layer.name)]], shapes),
          );
        }
        break;
      }
      case "default":
        for (const element of layer.elements) {
          if (element.type === "text" && element.renderAs === "html") {
            children.push(renderTextElement(element, ns, abId + "-", layer.name, warnings));
          }
          if (element.type === "snippet") {
            children.push(
              el("div", [
                ["class", ns + "aiAbs"],
                ["data-replaceable", "snippet"],
                ["data-key", element.key],
                ["style", positionToStyleString(element.computedPosition)],
              ]),
            );
          }
          if (element.type === "rawHtml") children.push(raw(element.content));
        }
        break;
    }
  }

  // html-after layers
  for (const layer of ab.layers) {
    if (layer.type !== "html-after") continue;
    if (layer.visible === false) continue;
    for (const element of layer.elements) {
      if (element.type === "rawHtml") children.push(raw(element.content));
    }
  }

  return el("div", abAttrs, children);
}

/**
 * Build the node tree for one document (or one artboard group).
 *
 * Returns structured warnings alongside the tree; callers that want strings use
 * `emitHTMLDocument()`, which serializes and projects them.
 */
export function buildHTMLTree(
  doc: EmitterReadyDocument,
  groupOptions?: EmitGroupOptions,
  options?: EmitterOptions,
): EmitHTMLTreeResult {
  const warnings: StructuredWarning[] = [];
  const tally: RenderTally = { lazyVideos: 0 };
  const resolvedDoc = applyEmitterOptions(doc, options);
  const settings = resolvedDoc.settings;
  // Where this surface puts the assets relative to the file being emitted. A
  // layout fact the surface states (`withAssetBase`); absent it, the emitted
  // file and its images are siblings, which is what a bare relative reference
  // means anyway.
  const assetBase = options?.assetBase || "";
  const ns = settings.namespace;
  const slug = groupOptions?.slug || settings.projectName || resolvedDoc.metadata.slug;
  const containerId = ns + slug + "-box";

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
  for (const cssWarning of cssWarnings) warnings.push(cssWarning);

  const nodes: HtmlNode[] = [];

  nodes.push(comment("Generated by all2html"));
  nodes.push(comment("source: " + slug));
  nodes.push(raw("\n"));

  if (settings.googleFonts === "link") {
    const fontLinks = renderGoogleFontsLinkTags(scopedDoc.fonts);
    if (fontLinks) {
      nodes.push(raw(fontLinks));
      nodes.push(raw("\n"));
    }
  }

  // Style block. The CSS is passed raw — `<style>` is a raw-text element and the
  // serializer neutralizes `</style` / `<!--` for it.
  nodes.push(el("style", [["media", "screen,print"]], [text("\n" + css + "\n")]));
  nodes.push(raw("\n"));

  // `ai2html` is kept verbatim for parity: newsroom CMS templates, embed
  // wrappers and resizer scripts written against ai2html select it, and dropping
  // it would break those pages silently. The namespaced class is *added*
  // alongside it so a page carrying more than one graphic — or a mix of ai2html
  // and all2html output — can address ours specifically.
  const containerAttrs: HtmlAttrs = [
    ["id", containerId],
    ["class", "ai2html " + ns + "all2html"],
  ];
  if (resolvedDoc.metadata.ariaRole) {
    containerAttrs.push(["role", resolvedDoc.metadata.ariaRole]);
  }
  const altTextId = containerId + "-img-desc";
  if (resolvedDoc.metadata.altText) {
    containerAttrs.push(["aria-describedby", altTextId]);
  }

  // Build asset index for O(1) lookups (used for both CSS vars and artboard rendering)
  const assetIdx = buildScopedAssetIndex(resolvedDoc.artboards, resolvedDoc.assets);

  // CSS custom property image loading: set image URLs as CSS vars on container.
  // `toCssUrlValue` is a *CSS* grammar, applied before the value becomes part of
  // an attribute — HTML attribute escaping cannot substitute for it.
  if (cssVarMode) {
    const varParts: string[] = [];
    const sortedForVars = [...scopedDoc.artboards].sort(
      (a, b) => a.breakpoint.minWidth - b.breakpoint.minWidth,
    );
    for (const ab of sortedForVars) {
      const bgAsset = getScopedArtboardAsset(assetIdx, ab);
      if (bgAsset) {
        const keyword = makeArtboardKey(ab, scopedDoc.artboards);
        varParts.push(
          "--" +
            keyword +
            "-img:" +
            toCssUrlValue(resolveAssetPath(bgAsset, settings, assetBase, warnings)),
        );
      }
    }
    if (varParts.length > 0) {
      containerAttrs.push(["style", varParts.join(";")]);
    }
  }

  const containerChildren: HtmlNode[] = [];

  // Alt text
  if (resolvedDoc.metadata.altText) {
    containerChildren.push(
      el(
        "div",
        [
          ["class", ns + "aiAltText"],
          ["id", altTextId],
        ],
        [text(resolvedDoc.metadata.altText)],
      ),
    );
  }

  // Clickable link. Escaping cannot make `javascript:` safe, so the URL is
  // checked against the scheme allowlist and the wrapper is dropped if it fails.
  let linkChildren: HtmlNode[] | null = null;
  if (settings.clickableLink) {
    if (isSafeUrl(settings.clickableLink)) {
      linkChildren = [];
    } else {
      pushUniqueStructuredWarning(
        warnings,
        createWarning(
          UNSAFE_URL_CODE,
          "markup",
          unsafeUrlWarning("clickableLink", settings.clickableLink),
          { setting: "clickableLink" },
        ),
      );
    }
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
    target.push(comment("Artboard: " + ab.name));
    target.push(
      renderArtboard(ab, scopedDoc, ns, slug, assetIdx, cssVarMode, assetBase, warnings, tally),
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
      el(
        "a",
        [
          ["class", ns + "ai2htmlLink"],
          ["href", settings.clickableLink],
        ],
        linkChildren,
      ),
    );
  }

  nodes.push(el("div", containerAttrs, containerChildren));

  // Lazy `<video>` loader, emitted only when a lazy video was actually written.
  // It goes in as a normal `text` child of a `script` element, so the
  // serializer's `escapeScriptContent()` covers it exactly like a custom JS
  // block — deliberately not a `raw()` node.
  if (tally.lazyVideos > 0) {
    nodes.push(
      el(
        "script",
        [
          ["type", "text/javascript"],
          [LAZY_VIDEO_SCRIPT_ATTR, LAZY_VIDEO_SCRIPT_ATTR_VALUE],
        ],
        [text(lazyVideoLoaderScript())],
      ),
    );
  }

  // Custom JS. Raw-text element again: the serializer neutralizes `</script` and
  // `<!--` so a block cannot break out or swallow the rest of the document.
  for (const block of resolvedDoc.customBlocks) {
    if (block.type === "js") {
      nodes.push(el("script", [["type", "text/javascript"]], [text(block.content)]));
    }
  }

  nodes.push(raw("\n"));
  nodes.push(comment("End all2html"));

  return { nodes: nodes, structuredWarnings: warnings, lazyVideoCount: tally.lazyVideos };
}

/** Build the tree and serialize it. The shared implementation of every HTML emit. */
export function emitHTMLDocument(
  doc: EmitterReadyDocument,
  groupOptions?: EmitGroupOptions,
  options?: EmitterOptions,
): EmitHTMLResult {
  const tree = buildHTMLTree(doc, groupOptions, options);
  return {
    html: serializeHtml(tree.nodes),
    warnings: warningMessages(tree.structuredWarnings),
    structuredWarnings: tree.structuredWarnings,
  };
}
