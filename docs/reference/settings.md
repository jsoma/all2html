---
title: Settings Reference
description: Canonical settings concepts and where they show up across the product.
---

# Settings Reference

all2html keeps one canonical settings model even though each source tool exposes it differently.

## Important Families

### Output

- `output`
- `htmlOutputPath`
- `imageOutputPath`
- `slug`

### Responsiveness

- `responsiveness`
- `textResponsiveness`
- `responsiveImageMode`

### Images

- `imageFormat`
- `jpgQuality`
- `pngNumberOfColors`
- `use2xImages`

### HTML Behavior

- `namespace`
- `clickableLink`
- `inlineSvg`

### Accessibility And Metadata

These mostly live in `metadata` rather than settings:

- `altText`
- `imageAltText`
- `ariaRole`
- `lang`

## Canonical Naming

Inside the IR and core config parsing, settings always use canonical camelCase keys. Tool-native snake_case belongs only on the tool side of the boundary.

## Where Settings Come From

Depending on the surface, settings can come from:

- document annotations
- config files
- panel UI state
- plugin UI controls
- CLI config

The important point is that they all resolve to the same final settings object before emitting output.
