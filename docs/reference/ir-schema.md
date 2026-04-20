---
title: IR Schema
description: Public technical summary of the canonical IR shape and key validation rules.
---

# IR Schema

This is the public technical summary of the canonical IR. It is intentionally descriptive rather than a raw dump of TypeScript or Zod source.

## Top-Level Shape

A document includes:

- `generator`
- `settings`
- `fonts`
- `artboards`
- `assets`
- `customBlocks`
- `metadata`
- `irVersion`

## Generator

Tracks which tool or importer created the IR and which versions were involved.

## Fonts

Font mappings normalize source-tool font names into web-ready family/weight/style information.

## Artboards

Each artboard contains:

- dimensions
- name/original name
- optional responsiveness metadata
- layers

## Layers And Elements

Layers contain typed elements. Text is carried as paragraphs and runs so emitters can preserve actual typography rather than treating everything as one string.

## Assets

Assets are exported files such as background images or overlay files. The asset key and the asset `id` must match.

## Metadata

Metadata carries document-level information like slug, alt text, and language. Accessibility information belongs here, not in random tool-specific side channels.

## Key Validation Rules

- `irVersion` is required
- `Paragraph.text` must match the concatenation of its runs
- asset IDs and asset map keys must agree
- unit conventions are fixed so emitters can trust them

## Units

- positions: pixels
- `fontSize`, `leading`, `spaceBefore`, `spaceAfter`: pixels
- `letterSpacing`: `em`
- opacity in base IR: 0–100
