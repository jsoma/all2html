---
title: Canonical IR
description: The shared document model used by every importer and plugin.
---

# Canonical IR

The IR is the contract between every input path and the shared rendering core.

## The Main Objects

### Document

The top-level record. It carries:

- generator metadata
- settings
- fonts
- artboards
- assets
- custom blocks
- metadata
- `irVersion`

### Artboard

An artboard is the export unit that ultimately becomes a graphic variant in the output. It has dimensions, layers, and optional responsiveness/image-only flags.

### Layer

Layers control grouping and export behavior. A layer can be:

- default content
- PNG overlay
- SVG overlay
- inline SVG
- video
- raw HTML hook
- snippet

### Element

Elements are the typed objects inside layers. The canonical element families are:

- text
- shape
- video
- raw HTML
- snippet

Text elements carry paragraphs and runs so typography survives the trip out of the source tool whenever possible.

## Shared Rules

The IR uses a few important conventions:

- canonical camelCase keys
- absolute pixel positions
- `letterSpacing` in `em`
- opacity on a 0–100 scale in the base IR
- `renderAs: "html" | "image"` on text elements when the exporter needs to explain whether text stays live

These rules matter because they let different tools feed the same pipeline without emitter-specific exceptions.

## Versioning

`Document.irVersion` is required. Right now the repo uses `"0.0.0"` for pre-release evolution, but the field is already the forward/backward compatibility hook for future schema changes.
