---
title: SVG Conversion
description: SVG import from single files, folders, or ZIPs, including Canva-style workflows.
---

# SVG Conversion

The SVG importer is the tool-agnostic path. It is especially useful for Canva exports, but it is not Canva-specific in the architecture.

**This path is beta.** It runs the full pipeline and emits every output format, but an SVG carries less information than a native design document, so text recovery and layer structure are best-effort. In particular, **SVG input supports no layer tags** — `:png`, `:svg`, `:video` and the HTML hooks are read from IR that some other exporter produced, and the SVG importer never produces them. Grouping and rendering come from filenames instead, as described below.

## Open It

- [Open the SVG browser converter](https://jsoma.github.io/all2html/svg-converter/)

## Inputs It Accepts

You can import:

- one SVG file
- a folder of SVG files
- a ZIP of SVG files

The browser app and the CLI both feed the same core importer and pipeline.

## Why This Matters For Canva

Canva’s multi-page SVG export becomes a set of per-page SVGs, often packaged as a ZIP. all2html can treat those files as artboards and run them through the same HTML pipeline as every other surface.

## Core Workflow

### CLI

```bash
all2html import svg export.zip -o output/
all2html import svg export.zip -o output/ --format standalone
all2html import svg export.zip -o output/ --format svelte
all2html import svg export.zip -o output/ --format react
```

### Browser App

Public page: [svg-converter](https://jsoma.github.io/all2html/svg-converter/)

```bash
pnpm dev:svg-dropzone
pnpm build:svg-dropzone
```

The browser app is fully client-side and accepts drag-and-drop SVG or ZIP input.

Optional JSON/JSONC config can set shared settings such as `googleFonts`. Font loading follows the same modes as the other exporters: `none`, `import`, or `link`.

## Naming Rules

Responsive grouping is driven by filenames. Preferred examples:

- `story--640.svg`
- `story--960.svg`
- `story--dynamic.svg`
- `story--image.svg`

Colon-style names such as `story:640` are still accepted where that convention already exists.

## Live Text And Raster Backgrounds

The importer tries to recover live HTML text when the SVG text can be mapped safely. The rest of the SVG is rasterized into ai2html-style PNG or JPG backgrounds by default.

That means:

- text can stay editable/live when possible
- complex vector effects can still render correctly as background imagery
- `--image` naming or image-only settings can force a fully rasterized result

## Formats

The SVG importer supports the full emitter surface:

- HTML
- Standalone HTML
- Svelte
- React

## Good Uses

- Canva export translation
- generic SVG-to-web conversion
- multi-file responsive graphics
- one-off visual tests through the browser app
