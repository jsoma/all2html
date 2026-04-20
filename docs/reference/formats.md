---
title: Formats
description: Output formats and bundles produced by all2html.
---

# Formats

all2html currently emits four main web output targets.

## HTML

The standard fragment output. Use this when the result will be embedded into a larger page or CMS surface.

## Standalone HTML

A self-contained page wrapper around the same rendered content. Use this when you want something easy to open directly in a browser or hand to someone as a complete page.

## Svelte

A component-oriented output for teams that want to integrate the result into a Svelte application.

## React

A component-oriented output for teams that want to integrate the result into a React application.

## Common Bundle Shape

Most export surfaces also involve:

- `ir.json`
- raster backgrounds or extracted assets
- emitted output files

That bundle shape is what makes the examples gallery and source/output samples practical.
