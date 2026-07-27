---
title: Special Layers
description: Overlays, hooks, and the difference between live content and rasterized background.
---

# Special Layers

Special layers are how all2html exports more than “background image plus text.”

## Common Layer Types

The tag names are shared across the richer surfaces:

- `:png`
- `:svg`
- inline SVG (spelled differently per surface — see below)
- `:video`
- `:html-before`
- `:html-after`

Illustrator also supports `:symbol` and `:div`. Figma does not: it recognizes the spelling only to warn you that the tag did nothing, and the layer exports as ordinary artwork.

## The Spelling Is Not Shared

The tag *names* are shared; the *syntax* is not. Each surface has its own parser, and a tag that does not match is not an error — the layer just exports as ordinary artwork.

| Surface | Inline SVG | How names are matched |
|---|---|---|
| Illustrator | `:svg,inline` or `:inline` | Splits on the first `:`, lowercases the rest, exact match, no trimming. |
| Figma | `:svg:inline` only | Case-insensitive prefix **or** suffix match, first match wins, direct children of the selected frame only. |
| SVG import | not available | No layer tags at all. Grouping and rendering come from the filename stem (`story--dynamic.svg`, `story--image.svg`, `story--640.svg`). |

If you copy a tag from an Illustrator document into Figma, or the other way round, check that row first. See the [Support Matrix](../reference/support-matrix.md) for the full comparison.

The document-level `inlineSvg` setting is not read on any surface — only the per-layer tag is.

## What Happens To Them

### Raster Background

Anything that should remain part of the flattened visual treatment ends up in the background image output.

### Separate Overlay

PNG, SVG, and video layers can become independent overlays instead of being baked into the background.

### HTML Hook

`html-before` and `html-after` let you inject controlled raw HTML around the artboard output.

## Live Text Vs Image Text

Text does not always stay live:

- safe, mappable text can remain HTML
- rotated, transformed, path, or explicitly image-only text can be rendered as image content instead

That tradeoff is recorded in the IR so the emitter does not need to guess.
