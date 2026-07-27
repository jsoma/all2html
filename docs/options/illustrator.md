---
title: Illustrator
description: Illustrator script and CEP panel workflow, settings, and output behavior.
---

# Illustrator

Illustrator is the center of gravity for all2html. If you want the most ai2html-like path, this is it.

## Downloads

- [Illustrator script](https://github.com/jsoma/all2html/releases/latest/download/all2html.js)
- [Panel `.zxp`](https://github.com/jsoma/all2html/releases/latest/download/all2html-panel.zxp)
- [Panel `.zip`](https://github.com/jsoma/all2html/releases/latest/download/all2html-panel.zip)
- [Install `.zxp` with ZXPInstaller](https://zxpinstaller.com/)

## Two Ways To Use It

### Script

Use the script when you want the original File → Scripts workflow and document-local settings through `ai2html-settings`.

Open Illustrator, select **File > Scripts > Other Scripts...** from the top menu and browse to the `.js` file.

### The Panel

The panel is much more fun! Use the panel – technically a *CEP panel* – when you want:

- app defaults
- per-document settings UI
- font mapping UI
- diagnostics
- `Open folder`

The panel is the better install for people who use all2html frequently.

## Core Workflow

1. Open a saved Illustrator document.
2. Create one or more artboards.
3. Add text, overlays, and special layers.
4. Run the script or export from the panel.
5. Rejoice in the generated HTML/images.

Output is written next to the document by default in `all2html-output/`.

## Important Settings

Illustrator supports much of the classic ai2html-style setting surface. The highest-visibility settings are:

- `image_format`
- `responsiveness`
- `output`
- `html_output_path`
- `image_output_path`
- `jpg_quality`
- `png_number_of_colors`
- `use_2x_images_if_possible`
- `google_fonts`

You can set them in:

- an `all2html-settings` text block in the document
- `all2html.config.json` next to the document
- the CEP panel

The panel also shows where values are coming from and lets you save defaults.

Names in an `all2html-settings` text block are snake_case (`image_format`); everywhere else — `all2html.config.json`, `ir.json`, the panel — they are camelCase (`imageFormat`). Both resolve to the same setting.

Two of these do less than they look like they do on Illustrator: `image_format` only distinguishes `jpg` from everything else (`png24` and `svg` both come out as 8-bit PNG), and `output: multiple-files` still emits a single HTML file. The export warns when you ask for something Illustrator will not produce. The full list is in the [Settings Reference](../reference/settings.md).

## Text Blocks

Settings and custom code travel in the document as text blocks whose **first line** is the block name:

- `all2html-settings` — snake_case `key: value` settings
- `all2html-text` — `key: value` text fields (headline, credit, and so on)
- `all2html-css`, `all2html-js`, `all2html-html`
- `all2html-html-before`, `all2html-html-after`

Every one of these also accepts the legacy `ai2html-` spelling, so documents authored against ai2html keep working unchanged. If a document somehow contains both an `all2html-settings` and an `ai2html-settings` block, the `all2html-` values win key by key; keys that appear only in the `ai2html-` block are still used. The order of the blocks in the document does not matter.

## Special Layers

Illustrator supports the richest set of special layers today. The main ones are:

- `:png`
- `:svg`
- `:svg,inline` (or the shorthand `:inline`)
- `:video`
- `:html-before`
- `:html-after`
- `:symbol`
- `:div`

Inline SVG is spelled **`:svg,inline`** — with a comma. `:svg:inline` is the *Figma* spelling and matches nothing in Illustrator: the layer will silently export as ordinary artwork instead.

Illustrator splits the layer name on the first `:`, lowercases the rest, and matches it exactly, so `My chart:PNG` works but `:png ` with a trailing space does not.

The document-level `inlineSvg` setting is not read by any surface. Tag the individual layer instead.

These either stay as overlays/hooks or influence how the final background and HTML are built. They are explained in more detail in [Special Layers](../how-it-works/special-layers.md), and compared across surfaces in the [Support Matrix](../reference/support-matrix.md).

## Fonts

Font mapping is done through `all2html.config.json` or the panel UI. The common case is mapping an Illustrator font name to a web family and weight:

```json
{
  "fonts": [
    {
      "sourceFont": "HelveticaNeue-Bold",
      "family": "'Helvetica Neue', sans-serif",
      "weight": "700"
    }
  ]
}
```

Older config files that use `aifont` still load, but new docs and generated config use `sourceFont`.

The panel also has a `Google Fonts` control. It writes the canonical `googleFonts` setting through config/panel state and the Illustrator `google_fonts` setting through `ai2html-settings`. Leave it `Off` for self-hosted or private fonts. Choose `CSS @import` to put a Google Fonts request at the top of generated CSS, or `Link tag` when the host page should receive preconnect and stylesheet links.

## What Illustrator Is Best For

- artboard-based responsive graphics
- classic newsroom ai2html workflows
- special-layer overlays and hooks
- deterministic background image generation
