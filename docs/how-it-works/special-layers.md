---
title: Special Layers
description: Overlays, hooks, and the difference between live content and rasterized background.
---

# Special Layers

Special layers are how all2html exports more than “background image plus text.”

## Common Layer Types

The current naming contract across the richer surfaces includes:

- `:png`
- `:svg`
- `:svg:inline`
- `:video`
- `:html-before`
- `:html-after`

Illustrator currently has the deepest support, but the naming model is shared where it makes sense.

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
