---
title: Support Matrix
description: What works where — output formats, special-layer tags, and features per export surface.
---

<!--
  GENERATED FILE — do not edit by hand.
  Source: src/ir/settings-definitions.ts, src/ir/setting-help.ts, src/core/capabilities.ts, src/ir/schema.ts
  Regenerate: pnpm docs:generate
  CI fails when this file is stale: pnpm check:generated-docs
-->

# Support Matrix

What each export surface can actually produce. Generated from the capability declarations in `src/core/capabilities.ts`, so it reflects the code rather than the roadmap.

**yes** means the surface does it. **no** means the surface accepts or exposes it and does nothing with it. **n/a** means it is meaningless there. **—** means the surface makes no declaration for that feature.

For per-setting support, see the [Settings Reference](settings.md). For how finished each surface is, see [Install](../install.md).

## Output Formats

Which emitters each surface can actually run.

| Feature | Illustrator | After Effects | Figma plugin | all2html CLI | Browser converter |
|---|---|---|---|---|---|
| `html` (fragment) | yes | **no** ¹ | yes | yes | yes |
| `standalone` (full page) | **no** ¹ | n/a | yes | yes | yes |
| `svelte` component | **no** ¹ | n/a | **no** ¹ | yes | yes |
| `react` component | **no** ¹ | n/a | **no** ¹ | yes | yes |

¹ Details:

- **`html` (fragment) · After Effects** — After Effects writes HTML through its own player template, not a core emitter.
- **`standalone` (full page) · Illustrator** — The standalone emitter is not reachable from the ExtendScript bundle.
- **`svelte` component · Illustrator** — Illustrator emits HTML only.
- **`svelte` component · Figma plugin** — Gated off in the plugin UI.
- **`react` component · Illustrator** — Illustrator emits HTML only.
- **`react` component · Figma plugin** — Gated off in the plugin UI.

## Special Layer Tags

Tagged layers become overlays or HTML hooks instead of being baked into the background raster. **The spelling is not the same on every surface** — read the syntax notes below before copying a tag between tools.

| Feature | Written as | Illustrator | After Effects | Figma plugin | all2html CLI | Browser converter |
|---|---|---|---|---|---|---|
| SVG overlay layer | `:svg` | yes | — | yes | yes ¹ | yes ¹ |
| Inline SVG layer | see the syntax notes below | yes ¹ | — | yes ¹ | yes ¹ | yes ¹ |
| PNG overlay layer | `:png` | yes | — | yes | yes ¹ | yes ¹ |
| Symbol layer | `:symbol` | yes | — | **no** ¹ | yes ¹ | yes ¹ |
| Div layer | `:div` | yes | — | **no** ¹ | yes ¹ | yes ¹ |
| Video layer | `:video` | yes | — | yes | yes ¹ | yes ¹ |
| HTML hook layers | `:html-before`, `:html-after` | yes | — | yes | yes ¹ | yes ¹ |

¹ Details:

- **SVG overlay layer · all2html CLI** — Read from the IR; the SVG importer never produces one.
- **SVG overlay layer · Browser converter** — Read from the IR; the SVG importer never produces one.
- **Inline SVG layer · Illustrator** — Accepts :svg,inline and :inline.
- **Inline SVG layer · Figma plugin** — Accepts :svg:inline only.
- **Inline SVG layer · all2html CLI** — Read from the IR; the SVG importer never produces one.
- **Inline SVG layer · Browser converter** — Read from the IR; the SVG importer never produces one.
- **PNG overlay layer · all2html CLI** — Read from the IR; the SVG importer never produces one.
- **PNG overlay layer · Browser converter** — Read from the IR; the SVG importer never produces one.
- **Symbol layer · Figma plugin** — Recognized only to warn. The tag is ignored and the layer exports as ordinary artwork.
- **Symbol layer · all2html CLI** — Read from the IR; the SVG importer never produces one.
- **Symbol layer · Browser converter** — Read from the IR; the SVG importer never produces one.
- **Div layer · Figma plugin** — Recognized only to warn. The tag is ignored and the layer exports as ordinary artwork.
- **Div layer · all2html CLI** — Read from the IR; the SVG importer never produces one.
- **Div layer · Browser converter** — Read from the IR; the SVG importer never produces one.
- **Video layer · all2html CLI** — Read from the IR; the SVG importer never produces one.
- **Video layer · Browser converter** — Read from the IR; the SVG importer never produces one.
- **HTML hook layers · all2html CLI** — Read from the IR; the SVG importer never produces one.
- **HTML hook layers · Browser converter** — Read from the IR; the SVG importer never produces one.

## Exact Tag Syntax

The three surfaces parse layer names with three different grammars. A tag that works in one may silently match nothing in another — nothing errors, the layer just exports as ordinary artwork.

**Illustrator** (`plugins/illustrator/exporter.jsx`) splits the layer name on the **first** `:`, lowercases the remainder, and matches it exactly with no trimming.

- Inline SVG is written `:svg,inline` **or** `:inline` — a comma, not a second colon.
- Artboard names use a separate grammar: `name:token,token`, `key=value`, or a bare integer width.

**Figma** (`plugins/figma/src/extract/layers.ts`) matches case-insensitively as a prefix **or** a suffix of the node name, first match wins, and only scans direct children of the selected frame.

- Inline SVG is written `:svg:inline` **only**. `:svg,inline` and `:inline` do not match.
- Frame tokens are `:dynamic`, `:fixed`, `:image-only`, or a bare integer width override. `:image` is still accepted as an older spelling of `:image-only`.

**SVG import** (`src/importers/svg/import-core.ts`) has **no layer tags at all**. Every layer imports as an ordinary layer. Grouping and rendering come from the filename stem instead: `--dynamic` / `:dynamic`, `--image` / `:image`, and `--<width>` / `:<width>`.

The rows above marked yes for the CLI and browser converter mean the emitters honor the tag when it is already present in the IR — for example in IR produced by Illustrator. The SVG importer never produces one.

## Other Features

Everything else the surfaces differ on.

| Feature | Illustrator | After Effects | Figma plugin | all2html CLI | Browser converter |
|---|---|---|---|---|---|
| Responsive artboard/frame grouping | yes | n/a | yes | yes | yes |
| 2x (retina) raster export | yes | — | **no** ¹ | yes ¹ | yes ¹ |
| Hyperlinks on text runs | yes | — | yes ¹ | yes | yes |
| Custom CSS/JS/HTML blocks | yes ¹ | — | yes ¹ | yes ¹ | yes ¹ |
| Promo image export | yes | — | **no** ¹ | **no** ¹ | **no** ¹ |
| Text effects (drop shadow, blur) | **no** ¹ | — | **no** ¹ | yes ¹ | yes ¹ |

¹ Details:

- **2x (retina) raster export · Figma plugin** — The Figma runtime exports transparent PNG at 1x with no format, quantizer, or quality controls.
- **2x (retina) raster export · all2html CLI** — Import path only.
- **2x (retina) raster export · Browser converter** — Import path only.
- **Hyperlinks on text runs · Figma plugin** — URL hyperlinks only; node-level links are dropped with a warning.
- **Custom CSS/JS/HTML blocks · Illustrator** — Matches all2html- and ai2html- prefixed block names; all2html- wins key-by-key when a document carries both settings blocks.
- **Custom CSS/JS/HTML blocks · Figma plugin** — Advanced JSONC only; there is no direct UI control.
- **Custom CSS/JS/HTML blocks · all2html CLI** — Read from the IR; SVG import produces none.
- **Custom CSS/JS/HTML blocks · Browser converter** — Read from the IR; SVG import produces none.
- **Promo image export · Figma plugin** — Promo image generation is implemented in the Illustrator exporter only.
- **Promo image export · all2html CLI** — Promo image generation is implemented in the Illustrator exporter only.
- **Promo image export · Browser converter** — Promo image generation is implemented in the Illustrator exporter only.
- **Text effects (drop shadow, blur) · Illustrator** — No exporter populates TextElement.effects.
- **Text effects (drop shadow, blur) · Figma plugin** — No extractor populates TextElement.effects.
- **Text effects (drop shadow, blur) · all2html CLI** — Rendered when present in the IR, but no importer or exporter produces one.
- **Text effects (drop shadow, blur) · Browser converter** — Rendered when present in the IR, but no importer or exporter produces one.
