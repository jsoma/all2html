---
title: IR Schema
description: Public technical summary of the canonical IR shape and key validation rules.
---

# IR Schema

This is the public technical summary of the canonical IR. It is intentionally descriptive rather than a raw dump of TypeScript or Zod source.

## Top-Level Shape

A document includes:

- `irVersion`
- `source`
- `settings`
- `fonts`
- `artboards`
- `assets`
- `customBlocks`
- `metadata`

## Source

Tracks which tool or adapter created the IR and any source-native identity that should survive the trip through the pipeline.

Required fields:

- `tool`

Common optional fields:

- `toolVersion`
- `adapterVersion`
- `id`
- `name`

## Fonts

Font mappings normalize source-tool font names into web-ready family/weight/style information.

Each mapping uses `sourceFont` as the tool-native font key.

## Artboards

Each artboard contains:

- stable `id`
- dimensions
- display `name`
- optional `source`
- optional responsiveness metadata
- layers

## Layers And Elements

Layers contain a stable `id`, display `name`, type, visibility, opacity, optional `source`, and typed elements. Text is carried as paragraphs and runs so emitters can preserve actual typography rather than treating everything as one string.

## Assets

Assets are exported files such as background images or overlay files. The asset key and the asset `id` must match. Assets reference canonical `artboardId` and optional `layerId` values instead of source-tool names.

## Metadata

Metadata carries document-level information like slug, alt text, and language. Accessibility information belongs here, not in random tool-specific side channels.

## Key Validation Rules

- `irVersion` is required
- `source.tool` is required
- artboards and layers must have stable IDs
- artboard IDs must be unique in the document
- layer IDs must be unique inside their artboard
- `Paragraph.text` must match the concatenation of its runs
- asset IDs and asset map keys must agree
- assets must reference artboards and layers by canonical ID
- unit conventions are fixed so emitters can trust them

## Units

- positions: pixels
- `fontSize`, `leading`, `spaceBefore`, `spaceAfter`: pixels
- `letterSpacing`: `em`
- opacity in base IR: 0–100
