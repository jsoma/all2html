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
5. Rejoice in the the generated HTML/images.

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

You can set them in:

- an `ai2html-settings` text block in the document
- `all2html.config.json` next to the document
- the CEP panel

The panel also shows where values are coming from and lets you save defaults.

## Special Layers

Illustrator supports the richest set of special layers today. The main ones are:

- `:png`
- `:svg`
- `:svg:inline`
- `:video`
- `:html-before`
- `:html-after`
- `:symbol`
- `:div`

These either stay as overlays/hooks or influence how the final background and HTML are built. They are explained in more detail in [Special Layers](../how-it-works/special-layers.md).

## Fonts

Font mapping is done through `all2html.config.json` or the panel UI. The common case is mapping an Illustrator font name to a web family and weight:

```json
{
  "fonts": [
    {
      "aifont": "HelveticaNeue-Bold",
      "family": "'Helvetica Neue', sans-serif",
      "weight": "700"
    }
  ]
}
```

## What Illustrator Is Best For

- artboard-based responsive graphics
- classic newsroom ai2html workflows
- special-layer overlays and hooks
- deterministic background image generation

> Screenshot placeholder
> Crop the main panel settings area plus one visible badge or font-mapping row.
