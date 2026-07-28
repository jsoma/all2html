---
title: all2html
description: Release-first docs for installing, exporting, and understanding all2html.
---

# all2html

all2html turns design documents into responsive web output. It started as a clean-room ai2html-style exporter for Illustrator and now includes Figma and SVG import paths that all meet at the same canonical IR and rendering pipeline. After Effects is a separate, limited path: one comp at a time, video plus timed HTML overlays, and it does not run the shared pipeline, so most canonical settings do not apply to it.

This project is **pre-launch** right now. Try everything. Some paths are more polished than others, but the point of this site is to make the current options understandable, downloadable, and easy to test.

- [Install all2html](install.md)
- [Browse export demos](examples/index.md)
- [Learn how it works](how-it-works/index.md)
- [See what works where](reference/support-matrix.md)

## Maturity By Surface

The surfaces are not equally finished. Pick one with your eyes open:

| Surface | Maturity | What that means |
|---|---|---|
| Illustrator | **Stable** | The production path. Script and panel are both supported, and it has the deepest feature coverage. |
| After Effects | **Limited** | Works for its narrow job — one comp, rendered video plus timed HTML overlays. It does not run the shared pipeline, so most settings on the [Settings Reference](reference/settings.md) do not apply to it. |
| Figma | **Beta** | Runnable and useful, but not yet a supported exporter. Expect rough edges, and check the [Settings Reference](reference/settings.md) before trusting a setting. |
| SVG conversion | **Beta** | The CLI and browser converter run the full pipeline, but SVG input carries less information than a native document, so text recovery and grouping are best-effort. |

[Full support matrix](reference/support-matrix.md) — output formats and special-layer tags, per surface.

## Quick Install

> Illustrator and After Effects panels need to be [installed with ZXPInstaller](https://zxpinstaller.com/)

- **Illustrator:** [panel](https://github.com/jsoma/all2html/releases/latest/download/all2html-panel.zxp) or [plain script](https://github.com/jsoma/all2html/releases/latest/download/all2html.js)
- **After Effects:** [panel](https://github.com/jsoma/all2html/releases/latest/download/all2html-panel.zxp) or [plain script](https://github.com/jsoma/all2html/releases/latest/download/all2html-after-effects.zip)
- **Figma:** [Figma plugin](https://github.com/jsoma/all2html/releases/latest/download/all2html-figma-plugin.zip)
- **Canva:** [Browser SVG converter](https://jsoma.github.io/all2html/svg-converter/)

## What You Can Use Today

### Illustrator — stable

The original all2html path. Use the script if you want the classic workflow, or the CEP panel if you want a modern settings surface with diagnostics and font mapping.

[Illustrator install and options](options/illustrator.md)

### After Effects — limited

Exports a rendered video plus timed HTML overlays from AE text layers. There is also a shared CEP panel surface if you want a UI for templates, font mappings, and output paths.

[After Effects install and options](options/after-effects.md)

### Figma — beta

The Figma plugin exports selected top-level frames into the same shared pipeline. The current UI targets HTML and Standalone HTML. It is beta: it runs on real files, but it is not yet a supported exporter.

[Figma install and options](options/figma.md)

### SVG Conversion — beta

You can import a single SVG, a folder of SVGs, or a ZIP of SVGs and render them through the same pipeline. This is the Canva-friendly path, but it is intentionally general-purpose rather than Canva-specific.

[Open the SVG browser converter](https://jsoma.github.io/all2html/svg-converter/)

[SVG conversion options](options/svg-conversion.md)

## How This Site Is Organized

- [Install](install.md) is the main entry point and download guide.
- [Options](options/illustrator.md) breaks down the workflow and settings per surface.
- [Examples](examples/index.md) gives you real source files and outputs to inspect.
- [How It Works](how-it-works/index.md) explains the IR, pipeline, adapter model, responsiveness, and special layers.
- [Reference](reference/settings.md) is the technical documentation for settings, formats, and schema shape.
- [Troubleshooting](troubleshooting.md) covers the common failure modes.
