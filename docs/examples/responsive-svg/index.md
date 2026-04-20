---
title: Responsive SVG Import
description: Multi-file SVG import example using responsive filename grouping.
---

# Responsive SVG Import

This example shows how multiple SVG files can become one responsive group.

## What It Shows

- multi-file SVG input
- responsive grouping from filename suffixes
- one imported IR document with grouped artboards
- per-artboard raster background images

## Sources

- [card--640.svg](card--640.svg)
- [card--960.svg](card--960.svg)

## Outputs

- [responsive-svg.html](responsive-svg.html)
- [ir.json](ir.json)
- [640px background](all2html-output/card-640.png)
- [960px background](all2html-output/card-960.png)

## Notes

The `--640` and `--960` suffixes are what let the importer treat these as related responsive variants.

> Screenshot placeholder
> Crop the output so both the mobile-scale and wider treatment can be compared side by side.
