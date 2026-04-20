---
title: Troubleshooting
description: Common install and export issues across Illustrator, After Effects, Figma, and SVG conversion.
---

# Troubleshooting

## CEP Panel Problems

If the panel opens but does not see your Illustrator or After Effects document:

- make sure the source file is saved
- restart the host app after updating the panel
- verify that the latest panel package is actually installed

If export fails from the panel, use the diagnostics commands from the repo root:

```bash
pnpm diagnostics:illustrator
pnpm diagnostics:after-effects
```

## Illustrator

Common failure modes:

- unsaved document
- CMYK document instead of RGB
- bad font mapping
- invalid special-layer content such as a broken video URL or empty HTML hook

## After Effects

Common failure modes:

- unsaved `.aep`
- wrong active comp
- missing output template
- overlay layers not prefixed correctly

## Figma

Common failure modes:

- stale or missing plugin build
- manifest imported without a fresh `dist/`
- no selected top-level frames
- equal-width responsive variants
- invalid JSONC in advanced config

## SVG Import

Common warnings are usually about one of these:

- text that could not stay live and was rasterized
- grouping names that are ambiguous or invalid
- unsupported effects preserved in the raster background
- missing linked assets

If you are testing Canva exports, prefer ZIP or folder inputs with stable filenames and keep the responsive suffixes consistent.
