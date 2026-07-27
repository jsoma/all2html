---
title: Settings Reference
description: Every canonical setting, its type, its default, and which surfaces actually honor it.
---

<!--
  GENERATED FILE — do not edit by hand.
  Source: src/ir/settings-definitions.ts, src/ir/setting-help.ts, src/core/capabilities.ts, src/ir/schema.ts
  Regenerate: pnpm docs:generate
  CI fails when this file is stale: pnpm check:generated-docs
-->

# Settings Reference

all2html keeps one canonical settings model even though each source tool exposes it differently. This page is generated from the setting definitions and the per-surface capability declarations in the source tree, so it cannot describe behavior the code does not have.

Settings always use canonical camelCase keys inside the IR and in `all2html.config.json`. Tool-native spellings such as `image_format` or `html_output_path` are accepted only on the tool side of the boundary — in an Illustrator `all2html-settings` text block (the legacy `ai2html-settings` name still works) — and are normalized before they reach the pipeline.

There are 33 settings.

## Surfaces

Every setting below is scored against these five surfaces. A surface with no explicit entry for a setting behaves as its default column says.

| Surface | Settings it does not name | Warns you at export time? | Surface note |
|---|---|---|---|
| Illustrator | honored | yes | — |
| After Effects | n/a — never reached | **no** — the declaration is documentation only | The After Effects exporter does not run the shared pipeline; it splices its own player template. |
| Figma plugin | honored | yes | — |
| all2html CLI | honored | yes | — |
| Browser converter | honored | yes | — |

A surface that warns tells you, during the export itself, whenever you asked for something it will not produce. A surface that does not warn will simply do something else in silence.

## Support Key

| Value | Meaning |
|---|---|
| yes | Read and acted on. |
| partial | Acted on for some values, entry paths, or output formats only. See the setting's own section. |
| **no** | The surface accepts the setting and does nothing with it. |
| n/a | Meaningless here — the surface never reaches the code the setting drives. |

## Support At A Glance

| Setting | Illustrator | After Effects | Figma plugin | all2html CLI | Browser converter |
|---|---|---|---|---|---|
| [`imageFormat`](#imageFormat) | partial | n/a | partial | partial | partial |
| [`writeImageFiles`](#writeImageFiles) | **no** | n/a | **no** | **no** | **no** |
| [`pngTransparent`](#pngTransparent) | yes | n/a | **no** | partial | partial |
| [`pngNumberOfColors`](#pngNumberOfColors) | yes | n/a | **no** | partial | partial |
| [`jpgQuality`](#jpgQuality) | yes | n/a | **no** | partial | partial |
| [`use2xImages`](#use2xImages) | yes | n/a | **no** | partial | partial |
| [`cacheBustToken`](#cacheBustToken) | yes | n/a | yes | yes | yes |
| [`namespace`](#namespace) | yes | n/a | yes | yes | yes |
| [`projectName`](#projectName) | yes | n/a | yes | yes | yes |
| [`output`](#output) | yes | n/a | yes | yes | yes |
| [`htmlOutputPath`](#htmlOutputPath) | yes | n/a | **no** | **no** | **no** |
| [`htmlOutputExtension`](#htmlOutputExtension) | yes | n/a | partial | partial | partial |
| [`imageOutputPath`](#imageOutputPath) | partial | n/a | yes | yes | yes |
| [`imageSourcePath`](#imageSourcePath) | yes | n/a | yes | yes | yes |
| [`responsiveness`](#responsiveness) | yes | n/a | yes | yes | yes |
| [`textResponsiveness`](#textResponsiveness) | yes | n/a | yes | yes | yes |
| [`maxWidth`](#maxWidth) | yes | n/a | yes | yes | yes |
| [`centerHtmlOutput`](#centerHtmlOutput) | yes | n/a | yes | yes | yes |
| [`renderTextAs`](#renderTextAs) | yes | n/a | **no** | partial | partial |
| [`renderRotatedSkewedTextAs`](#renderRotatedSkewedTextAs) | yes | n/a | **no** | **no** | **no** |
| [`googleFonts`](#googleFonts) | yes | yes | yes | yes | yes |
| [`testingMode`](#testingMode) | yes | n/a | yes | yes | yes |
| [`includeResizerCss`](#includeResizerCss) | yes | n/a | yes | yes | yes |
| [`includeResizerWidths`](#includeResizerWidths) | yes | n/a | yes | yes | yes |
| [`responsiveImageMode`](#responsiveImageMode) | **no** | n/a | yes | yes | yes |
| [`useLazyLoader`](#useLazyLoader) | yes | n/a | yes | yes | yes |
| [`inlineSvg`](#inlineSvg) | **no** | n/a | **no** | **no** | **no** |
| [`svgIdPrefix`](#svgIdPrefix) | **no** | n/a | **no** | **no** | **no** |
| [`svgEmbedImages`](#svgEmbedImages) | yes | n/a | **no** | **no** | **no** |
| [`clickableLink`](#clickableLink) | yes | n/a | yes | yes | yes |
| [`createPromoImage`](#createPromoImage) | yes | n/a | **no** | **no** | **no** |
| [`promoImageWidth`](#promoImageWidth) | yes | n/a | **no** | **no** | **no** |
| [`localPreviewTemplate`](#localPreviewTemplate) | **no** | n/a | **no** | yes | **no** |

## Settings

<a id="imageFormat"></a>
### `imageFormat`

**Type:** array of `auto`, `png`, `png24`, `jpg`, `svg` · **Default:** `["auto"]` · **Panel label:** `Format`

Chooses the raster or vector format used for exported background artwork.

Auto lets the pipeline pick a reasonable image format. SVG keeps vector layers where possible, while PNG and JPEG trade off transparency, file size, and fidelity.

Start with Auto unless you know the output needs a specific format.

- **Auto** — Lets all2html choose the image format based on the artwork.
- **PNG (8-bit)** — Palette-based PNG. Good for flatter graphics with fewer colors.
- **PNG (24-bit)** — Full-color PNG. Larger but more faithful, with transparency support.
- **JPEG** — Smaller for photo-heavy graphics, but no transparency and more compression artifacts.
- **SVG** — Keeps vector output when compatible, but can expose more browser rendering differences.

| Surface | Support | What actually happens |
|---|---|---|
| Illustrator | partial | Honored values: `auto`, `png`, `jpg`. Illustrator rasterizes 8-bit PNG for every value except jpg, so png24 and svg both produce an 8-bit PNG. |
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | partial | Honored values: `auto`, `png24`. The Figma runtime always exports full-color PNG with alpha, equivalent to png24. |
| all2html CLI | partial | Honored on the `import` path only. Rasterization settings are honored by `import svg`. The `render` command never rasterizes, so this value is inert. |
| Browser converter | partial | Honored on the `import` path only. Rasterization settings are honored by `import svg`. The `render` command never rasterizes, so this value is inert. |

<a id="writeImageFiles"></a>
### `writeImageFiles`

**Type:** boolean · **Default:** `true`

Asks the exporter to write extracted image assets to disk alongside the emitted output.

| Surface | Support | What actually happens |
|---|---|---|
| Illustrator | **no** | Illustrator always writes image files. |
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | Figma always writes extracted assets into the export ZIP. |
| all2html CLI | **no** | Extracted assets are always written next to the emitted files. |
| Browser converter | **no** | Extracted assets are always written next to the emitted files. |

<a id="pngTransparent"></a>
### `pngTransparent`

**Type:** boolean · **Default:** `false`

Exports PNG backgrounds with a transparent background instead of a flat matte.

Honored on: Illustrator.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | This surface behaves as `true`, whatever you set. The Figma runtime exports transparent PNG at 1x with no format, quantizer, or quality controls. |
| all2html CLI | partial | Honored on the `import` path only. Rasterization settings are honored by `import svg`. The `render` command never rasterizes, so this value is inert. |
| Browser converter | partial | Honored on the `import` path only. Rasterization settings are honored by `import svg`. The `render` command never rasterizes, so this value is inert. |

<a id="pngNumberOfColors"></a>
### `pngNumberOfColors`

**Type:** integer, 1–256 · **Default:** `128`

Size of the color palette used when quantizing 8-bit PNG output. Fewer colors means smaller files and more banding.

Honored on: Illustrator.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | There is no equivalent behavior here, so any value diverges. The Figma runtime exports full-color PNG with no quantizer, so no color count is honored. |
| all2html CLI | partial | Honored on the `import` path only. Rasterization settings are honored by `import svg`. The `render` command never rasterizes, so this value is inert. |
| Browser converter | partial | Honored on the `import` path only. Rasterization settings are honored by `import svg`. The `render` command never rasterizes, so this value is inert. |

<a id="jpgQuality"></a>
### `jpgQuality`

**Type:** integer, 0–100 · **Default:** `85`

JPEG compression quality for rasterized backgrounds, from 0 (worst) to 100 (best).

Honored on: Illustrator.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | The Figma runtime exports transparent PNG at 1x with no format, quantizer, or quality controls. |
| all2html CLI | partial | Honored on the `import` path only. Rasterization settings are honored by `import svg`. The `render` command never rasterizes, so this value is inert. |
| Browser converter | partial | Honored on the `import` path only. Rasterization settings are honored by `import svg`. The `render` command never rasterizes, so this value is inert. |

<a id="use2xImages"></a>
### `use2xImages`

**Type:** boolean · **Default:** `true` · **Panel label:** `Retina (2x) images`

Exports high-density image assets so the graphic looks sharper on retina screens.

This writes larger source images and scales them down in the browser. It usually improves crispness, but increases image weight.

Leave this on for production web graphics unless file size is unusually tight.

Honored on: Illustrator.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | This surface behaves as `false`, whatever you set. The Figma runtime exports transparent PNG at 1x with no format, quantizer, or quality controls. |
| all2html CLI | partial | Honored on the `import` path only. Rasterization settings are honored by `import svg`. The `render` command never rasterizes, so this value is inert. |
| Browser converter | partial | Honored on the `import` path only. Rasterization settings are honored by `import svg`. The `render` command never rasterizes, so this value is inert. |

<a id="cacheBustToken"></a>
### `cacheBustToken`

**Type:** positive integer, or `null` · **Default:** `null`

Appended to every emitted image URL as `?v=<token>` so a re-export busts CDN and browser caches.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="namespace"></a>
### `namespace`

**Type:** string — empty, or a CSS-safe identifier (letters, digits, `_`, `-`, not starting with a digit) · **Default:** `"g-"`

Prefix applied to every generated CSS class and id (`g-artboard`, `g-pstyle0`, and so on). Change it when the host page already uses the default prefix.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="projectName"></a>
### `projectName`

**Type:** string — empty, or a CSS-safe identifier (letters, digits, `_`, `-`, not starting with a digit) · **Default:** `""`

Base name used for emitted files, the container id, and the CSS scope. Falls back to `metadata.slug` when empty.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="output"></a>
### `output`

**Type:** one of `one-file`, `multiple-files` · **Default:** `"one-file"` · **Panel label:** `Output`

Controls whether related artboards are emitted into one HTML file or split into separate files.

Single file is the classic ai2html-style output for responsive artboard groups. Per artboard writes a separate file for each base artboard group.

Use Single file for one graphic with breakpoints; use Per artboard when each artboard should stand alone.

- **Single file** — Emits one HTML file that can contain responsive artboard variants together.
- **Per artboard** — Writes separate output files instead of bundling all artboards into one result.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="htmlOutputPath"></a>
### `htmlOutputPath`

**Type:** string · **Default:** `"all2html-output/"` · **Panel label:** `HTML path`

Folder where the exported HTML files are written, relative to the Illustrator document unless you use an absolute path.

By default, all2html writes next to the document in all2html-output/. Use a different folder when your publishing workflow expects HTML somewhere else.

Most projects can leave this at all2html-output/.

Honored on: Illustrator.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | Figma delivers a ZIP whose layout is fixed by the bundle manifest. |
| all2html CLI | **no** | Output location comes from the -o flag. |
| Browser converter | **no** | Output location comes from the -o flag. |

<a id="htmlOutputExtension"></a>
### `htmlOutputExtension`

**Type:** string · **Default:** `".html"`

File extension used for emitted HTML files, for CMSes that expect something other than `.html`.

Honored on: Illustrator.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | partial | Not honored for the `standalone`, `svelte`, `react` format. Those formats write their own value instead: `standalone` writes `.html`, `svelte` writes `.svelte`, `react` writes `.jsx`. Only the html emitter uses this extension. The svelte and react emitters force .svelte and .jsx/.tsx, and the standalone emitter always writes .html. |
| all2html CLI | partial | Not honored for the `standalone`, `svelte`, `react` format. Those formats write their own value instead: `standalone` writes `.html`, `svelte` writes `.svelte`, `react` writes `.jsx`. Only the html emitter uses this extension. The svelte and react emitters force .svelte and .jsx/.tsx, and the standalone emitter always writes .html. |
| Browser converter | partial | Not honored for the `standalone`, `svelte`, `react` format. Those formats write their own value instead: `standalone` writes `.html`, `svelte` writes `.svelte`, `react` writes `.jsx`. Only the html emitter uses this extension. The svelte and react emitters force .svelte and .jsx/.tsx, and the standalone emitter always writes .html. |

<a id="imageOutputPath"></a>
### `imageOutputPath`

**Type:** string · **Default:** `"all2html-output/"` · **Panel label:** `Image path`

Folder where exported image assets are written.

Illustrator writes the HTML and its images into one folder, and HTML path wins when both are set — so this can move that folder, but it cannot put the images somewhere separate. To point the markup at a different location than the files were written to, use Image src prefix.

Keep it aligned with HTML path unless you have a specific asset pipeline.

Honored on: Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| Illustrator | partial | Illustrator writes the HTML and its images into a single output directory, and htmlOutputPath takes precedence when set. This value can move that one directory, but it never creates a separate image folder, so the emitted src is always a bare filename. Use imageSourcePath if your CMS serves the images from a different URL. |
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="imageSourcePath"></a>
### `imageSourcePath`

**Type:** string · **Default:** `""`

Prefix prepended to image `src` attributes in the emitted HTML. Use it when images are served from a different URL root than the one they were written to.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="responsiveness"></a>
### `responsiveness`

**Type:** one of `fixed`, `dynamic` · **Default:** `"fixed"` · **Panel label:** `Layout`

Controls whether artboards export at fixed widths or as layouts that can stretch with the container.

Fixed swaps between artboards at breakpoints while keeping each artboard width locked. Dynamic lets an artboard scale more fluidly and uses aspect-ratio spacing in the HTML.

Leave this on Fixed unless the layout itself should stretch between breakpoints.

- **Fixed** — Keeps each artboard at a defined width and swaps variants at breakpoints.
- **Dynamic** — Lets an artboard scale more fluidly instead of behaving like a locked-width panel.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="textResponsiveness"></a>
### `textResponsiveness`

**Type:** one of `fixed`, `dynamic` · **Default:** `"dynamic"` · **Panel label:** `Text sizing`

Controls whether live HTML text keeps fixed sizing or scales more dynamically with the layout.

This only matters when text is emitted as HTML. Dynamic text sizing produces more flexible text positioning, while Fixed keeps the text box behavior closer to the Illustrator artboard.

Dynamic is the safer default for live HTML text.

- **Dynamic** — Lets live HTML text scale and reposition more fluidly.
- **Fixed** — Keeps live HTML text closer to fixed artboard geometry.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="maxWidth"></a>
### `maxWidth`

**Type:** positive number, or `null` · **Default:** `null`

Caps the width of the generated container in pixels. `null` leaves the graphic uncapped.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="centerHtmlOutput"></a>
### `centerHtmlOutput`

**Type:** boolean · **Default:** `true`

Centers the generated container and its artboards with `margin: 0 auto`.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="renderTextAs"></a>
### `renderTextAs`

**Type:** one of `html`, `image` · **Default:** `"html"` · **Panel label:** `Text as`

Chooses whether text is emitted as live HTML or baked into the exported background image.

HTML text stays searchable, selectable, and styleable, but depends on browser fonts. Image text preserves Illustrator appearance more exactly, but it is no longer live text.

Use HTML unless fidelity problems force you to rasterize the type.

- **HTML** — Keeps text live in the markup for accessibility, search, and CSS styling.
- **Image** — Renders text into the exported image for maximum visual fidelity.

Honored on: Illustrator.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | Figma always emits live HTML text and always hides text before the background raster. |
| all2html CLI | partial | Honored on the `import` path only. Text rendering mode is decided by the exporter that produced the IR. On `render` the value is inert. |
| Browser converter | partial | Honored on the `import` path only. Text rendering mode is decided by the exporter that produced the IR. On `render` the value is inert. |

<a id="renderRotatedSkewedTextAs"></a>
### `renderRotatedSkewedTextAs`

**Type:** one of `html`, `image` · **Default:** `"html"`

Whether rotated and skewed text is kept as live HTML or baked into the background image. Browsers place transformed text less predictably than upright text.

Honored on: Illustrator.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | Figma always emits rotated and skewed text as live HTML. |
| all2html CLI | **no** | Only the Illustrator exporter acts on this; the core always emits rotated and skewed text as live HTML. |
| Browser converter | **no** | Only the Illustrator exporter acts on this; the core always emits rotated and skewed text as live HTML. |

<a id="googleFonts"></a>
### `googleFonts`

**Type:** one of `none`, `import`, `link` · **Default:** `"none"` · **Panel label:** `Google Fonts`

Optionally adds Google Fonts loading markup for mapped live text fonts.

The generated URL is based on the first concrete CSS family in each font mapping. all2html does not validate whether the family exists on Google Fonts; invalid requests fall back through normal browser font behavior.

Off keeps exports self-contained and avoids external font requests.

- **Off** — Does not emit Google Fonts loading markup.
- **CSS @import** — Adds an @import rule at the top of generated CSS. This is the recommended enabled mode for snippets.
- **Link tag** — Adds preconnect and stylesheet link tags before generated style output.

Honored on every surface.

<a id="testingMode"></a>
### `testingMode`

**Type:** boolean · **Default:** `false`

Tints live HTML text red so it is obvious which text is real HTML and which is baked into the background image.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="includeResizerCss"></a>
### `includeResizerCss`

**Type:** boolean · **Default:** `true` · **Panel label:** `Container query CSS`

Adds the responsive CSS rules that switch between artboards at breakpoints.

Without this CSS, multi-artboard responsive output loses the generated container-query rules that show the right variant at the right width.

Leave this on unless you are intentionally replacing the generated CSS.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="includeResizerWidths"></a>
### `includeResizerWidths`

**Type:** boolean · **Default:** `true`

Adds `data-min-width` / `data-max-width` attributes to each artboard so an external resizer script can pick the right variant.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="responsiveImageMode"></a>
### `responsiveImageMode`

**Type:** one of `img-src`, `css-var` · **Default:** `"img-src"`

How responsive background images are attached: as `<img src>` elements, or as CSS custom properties so only the visible artboard's image is fetched.

Honored on: Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| Illustrator | **no** | Illustrator always emits img-src images. |
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="useLazyLoader"></a>
### `useLazyLoader`

**Type:** boolean · **Default:** `true`

Defers loading of background images and video until they are near the viewport.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="inlineSvg"></a>
### `inlineSvg`

**Type:** boolean · **Default:** `false` · **Panel label:** `Inline SVG layers`

Keeps eligible SVG layers inline in the HTML instead of rasterizing them into background images.

Inline SVG can make vector details stay crisp and stylable, but it also produces more verbose HTML and can reveal browser rendering differences.

Leave this off unless you specifically need live vector layers in the markup.

| Surface | Support | What actually happens |
|---|---|---|
| Illustrator | **no** | Tag individual layers with :svg,inline instead. The document-level setting is not read. |
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | Tag individual layers with :svg:inline instead. The document-level setting is not read. |
| all2html CLI | **no** | Only the per-layer inline flag in the IR is read. |
| Browser converter | **no** | Only the per-layer inline flag in the IR is read. |

<a id="svgIdPrefix"></a>
### `svgIdPrefix`

**Type:** string — empty, or a CSS-safe identifier (letters, digits, `_`, `-`, not starting with a digit) · **Default:** `""`

Prefix applied to ids inside inline SVG output, so several inline SVGs on one page cannot collide.

| Surface | Support | What actually happens |
|---|---|---|
| Illustrator | **no** | SVG id prefixing is not implemented on any surface; ids are emitted unprefixed. |
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | SVG id prefixing is not implemented on any surface; ids are emitted unprefixed. |
| all2html CLI | **no** | SVG id prefixing is not implemented on any surface; ids are emitted unprefixed. |
| Browser converter | **no** | SVG id prefixing is not implemented on any surface; ids are emitted unprefixed. |

<a id="svgEmbedImages"></a>
### `svgEmbedImages`

**Type:** boolean · **Default:** `false` · **Panel label:** `Embed images in SVG`

Embeds image assets directly inside inline SVG output instead of referencing separate files.

This can make a self-contained SVG fragment, but it increases HTML size and duplicates binary image data.

Leave this off unless you need a fully self-contained SVG fragment.

Honored on: Illustrator.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | Figma's SVG export takes no embed option, so linked images stay referenced. |
| all2html CLI | **no** | Inline SVG keeps linked images referenced. |
| Browser converter | **no** | Inline SVG keeps linked images referenced. |

<a id="clickableLink"></a>
### `clickableLink`

**Type:** string · **Default:** `""`

Wraps the whole graphic in a link to this URL.

Honored on: Illustrator, Figma plugin, all2html CLI, Browser converter.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |

<a id="createPromoImage"></a>
### `createPromoImage`

**Type:** boolean · **Default:** `false`

Also exports a standalone promo/social image alongside the normal output.

Honored on: Illustrator.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | Promo image generation is implemented in the Illustrator exporter only. |
| all2html CLI | **no** | Promo image generation is implemented in the Illustrator exporter only. |
| Browser converter | **no** | Promo image generation is implemented in the Illustrator exporter only. |

<a id="promoImageWidth"></a>
### `promoImageWidth`

**Type:** positive integer · **Default:** `1024`

Width in pixels of the exported promo image.

Honored on: Illustrator.

| Surface | Support | What actually happens |
|---|---|---|
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | Promo image generation is implemented in the Illustrator exporter only. |
| all2html CLI | **no** | Promo image generation is implemented in the Illustrator exporter only. |
| Browser converter | **no** | Promo image generation is implemented in the Illustrator exporter only. |

<a id="localPreviewTemplate"></a>
### `localPreviewTemplate`

**Type:** string · **Default:** `""`

Path to a template file that the standalone emitter wraps the output in, instead of its built-in page shell.

Honored on: all2html CLI.

| Surface | Support | What actually happens |
|---|---|---|
| Illustrator | **no** | Illustrator emits an HTML fragment only, so the standalone preview template is never applied. |
| After Effects | n/a | Surface default — see [Surfaces](#surfaces). |
| Figma plugin | **no** | The browser standalone emitter reads the template only to discard it. |
| Browser converter | **no** | The browser standalone emitter reads the template only to discard it. |

## Not Settings

These keys are frequently mistaken for settings. They live in `metadata` on the IR document, not in `settings`, and setting them under `settings` does nothing:

- `slug`
- `lang`
- `headline`
- `leadin`
- `summary`
- `notes`
- `sources`
- `credit`
- `altText`
- `imageAltText`
- `ariaRole`

`metadata` also accepts arbitrary extra keys. The core pipeline never reads them; they are passthrough for emitters and downstream consumers.

## Where Settings Come From

Depending on the surface, settings can arrive from a document text block, a config file, panel UI state, plugin UI controls, or CLI config. They all resolve into the same settings object before anything is emitted.

See also: [Support Matrix](support-matrix.md) for output formats and special-layer tags per surface.
