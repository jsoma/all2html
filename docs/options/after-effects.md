---
title: After Effects
description: After Effects script and CEP panel workflow, output shape, and current limits.
---

# After Effects

The After Effects path turns a comp into a video export plus timed HTML overlays. It is different from Illustrator on purpose: it is about temporal graphics, not responsive artboards.

## Downloads

- [After Effects script](https://github.com/jsoma/all2html/releases/latest/download/all2html-after-effects.zip)
- [Panel `.zxp`](https://github.com/jsoma/all2html/releases/latest/download/all2html-panel.zxp)
- [Panel `.zip`](https://github.com/jsoma/all2html/releases/latest/download/all2html-panel.zip)
- [Install `.zxp` with ZXPInstaller](https://zxpinstaller.com/)

## Two Ways To Use It

### Packaged `.jsx` Script

This is the simplest path for AE users. Download `all2html-after-effects.zip`, unzip it, and run `all2html-ae.jsx`.

### Shared Panel

The panel (technically a *CEP panel*) adds an interface for:

- comp selection
- overlay prefix override
- output-root override
- output-module templates
- font mapping
- export diagnostics

## Core Workflow

1. Open and save the `.aep` file.
2. Make the target comp active.
3. Prefix overlay text layers with `overlay:`.
4. Run the script or export from the panel.
5. Collect the generated video, HTML, JSON, and summary files.

By default, output is written next to the project under `all2html-ae-output/<comp-slug>/`.

## What Gets Exported

The AE exporter is intentionally focused:

- the rendered video
- timed text overlays from matching layers
- sampled layout/timing/style information needed to place the overlays

It is not trying to recreate every AE feature as editable web content.

## Fonts And Project Config

The standalone script and the panel both read project-local configuration from `all2html-ae.config.json` next to the `.aep`.

That file is used for:

- font mappings
- Google Fonts loading mode
- overlay prefix
- output root
- video template
- poster template

The shared panel exposes the same `Google Fonts` choices as Illustrator and Figma. `CSS @import` injects an `@import` rule into the player template's style block. `Link tag` injects Google preconnect and stylesheet links before the player CSS. Leave it off for self-hosted fonts, private fonts, or fully offline exports.

## Current Limits

The AE exporter is useful now, but it is narrower than Illustrator:

- one active comp at a time
- no batch export
- no responsive variants
- no shape/SVG overlay export
- text animation details are sampled values, not semantic reconstructions

That is expected. It is the right tool when you need HTML over rendered motion, not when you need an artboard-driven layout system.

> Screenshot placeholder
> Crop the AE panel export section or a rendered output folder showing the video, HTML, and summary files together.
