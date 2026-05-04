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
- `googleFonts`

### Accessibility And Metadata

These mostly live in `metadata` rather than settings:

- `altText`
- `imageAltText`
- `ariaRole`
- `lang`

## Covered Panel Settings

<a id="responsiveness"></a>
### `responsiveness`

**Panel label:** `Layout`

Controls whether artboards export at fixed widths or as layouts that can stretch with the container.

Use `fixed` for classic ai2html-style breakpoint swaps. Use `dynamic` when the layout itself should scale more fluidly instead of behaving like a locked-width panel.

Tradeoffs: `fixed` is easier to reason about and matches newsroom embed expectations. `dynamic` is more flexible, but you should expect more responsive behavior in the emitted HTML and CSS.

<a id="renderTextAs"></a>
### `renderTextAs`

**Panel label:** `Text as`

Chooses whether text is emitted as live HTML or baked into the exported background image.

Use `html` when you want searchable, selectable, and styleable text. Use `image` when exact Illustrator fidelity matters more than live text.

Tradeoffs: HTML is better for accessibility and editing. Image text is more faithful visually, but loses semantic text behavior.

<a id="googleFonts"></a>
### `googleFonts`

**Panel label:** `Google Fonts`

Controls whether all2html emits Google Fonts loading markup for mapped live text fonts.

Supported values:

- `none`: emits no external font loading markup
- `import`: prepends a CSS `@import` rule to the generated CSS
- `link`: emits Google preconnect tags plus a stylesheet `<link>` before the generated style output

The generated URL comes from the first non-generic, non-web-safe CSS family in each font mapping. For example, `'IBM Plex Sans', system-ui, sans-serif` becomes an `IBM Plex Sans` request. all2html does not validate that a family exists on Google Fonts; invalid family requests fall back through normal browser font behavior.

Tradeoffs: `none` is best for privacy, self-hosted fonts, and fully offline output. `import` is the recommended enabled mode for snippets and component output. `link` is useful when the integration expects font loading markup outside the generated CSS.

<a id="output"></a>
### `output`

**Panel label:** `Output`

Controls whether related artboards are emitted into one HTML file or split into separate files.

Use `one-file` for one responsive graphic with multiple artboards or breakpoints. Use `multiple-files` when each artboard or responsive group should stand alone as its own deliverable.

Tradeoffs: one file is simpler for a single embed; multiple files are easier when publishing outputs separately.

<a id="imageFormat"></a>
### `imageFormat`

**Panel label:** `Format`

Chooses the raster or vector format used for exported background artwork.

Use `auto` unless you know the output needs a specific format. PNG is better for transparency and flatter artwork; JPEG is smaller for photo-heavy work; SVG keeps vector output when compatible.

Tradeoffs: PNG is larger but safer, JPEG is smaller but lossy, and SVG can stay crisp while exposing more browser rendering differences.

<a id="use2xImages"></a>
### `use2xImages`

**Panel label:** `Retina (2x) images`

Exports high-density image assets so the graphic looks sharper on retina screens.

Use it when display quality matters and you can afford larger assets. Turn it off when file size is the main constraint.

Tradeoffs: sharper images versus heavier image payloads.

<a id="htmlOutputPath"></a>
### `htmlOutputPath`

**Panel label:** `HTML path`

Controls where exported HTML files are written. Relative paths are resolved next to the Illustrator document unless you use an absolute path.

Use the default `all2html-output/` for most projects. Change it when your publishing workflow expects HTML somewhere else.

Tradeoffs: custom paths help fit an asset pipeline, but make the output location less obvious when you reopen the document later.

<a id="imageOutputPath"></a>
### `imageOutputPath`

**Panel label:** `Image path`

Controls where exported image assets are written.

Most projects keep this aligned with `htmlOutputPath`. Split it only when your build or CMS wants images in a different location from the HTML files.

Tradeoffs: separate asset roots can be useful, but you then need to keep image references and deployment paths in sync.

<a id="textResponsiveness"></a>
### `textResponsiveness`

**Panel label:** `Text sizing`

Controls whether live HTML text keeps fixed sizing or scales more dynamically with the layout.

This matters only when text is emitted as HTML. Use `dynamic` for more flexible live text behavior. Use `fixed` when you want text geometry to stay closer to the Illustrator artboard.

Tradeoffs: dynamic adapts better to responsive layouts; fixed is more rigid but can feel more predictable.

<a id="includeResizerCss"></a>
### `includeResizerCss`

**Panel label:** `Container query CSS`

Adds the responsive CSS rules that switch between artboards at breakpoints.

Leave it on for normal responsive exports. Turn it off only if you are deliberately replacing the generated CSS with your own responsive handling.

Tradeoffs: the default generated CSS is convenient, but custom site integrations may prefer tighter control.

<a id="inlineSvg"></a>
### `inlineSvg`

**Panel label:** `Inline SVG layers`

Keeps eligible SVG layers inline in the HTML instead of rasterizing them into background images.

Use it when you need live vector layers in the markup for crispness or styling hooks. Leave it off when you want simpler HTML and more predictable cross-browser behavior.

Tradeoffs: inline SVG can stay crisp and editable, but produces more verbose markup and can surface more browser differences.

<a id="svgEmbedImages"></a>
### `svgEmbedImages`

**Panel label:** `Embed images in SVG`

Embeds image assets directly inside inline SVG output instead of referencing separate files.

Use it when you need a self-contained SVG fragment. Leave it off when normal external image files are acceptable.

Tradeoffs: self-contained SVG is convenient, but increases HTML size and duplicates binary image data.

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
