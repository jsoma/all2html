---
title: Figma
description: Figma manifest-import workflow, export model, and current plugin behavior.
---

# Figma

**The Figma plugin is beta.** It runs, it fits the same pipeline as the other surfaces, and it exports real newsroom files — but it is not a supported exporter yet. Expect to check the output, and check the [Settings Reference](../reference/settings.md) before relying on a setting: several settings that the Illustrator path honors do nothing here.

Beta means, concretely: no repeated live-export sign-off yet, and the raster export is fixed at transparent full-color PNG at 1x regardless of what you set.

## Download

- [Figma plugin `.zip`](https://github.com/jsoma/all2html/releases/latest/download/all2html-figma-plugin.zip)

## Install Shape

1. Download `all2html-figma-plugin.zip`.
2. Unzip it.
3. In Figma, choose **Import plugin from manifest...**
4. Select `manifest.json`.

The extracted folder needs to stay intact because the manifest points at built files inside `dist/`.

## Core Workflow

1. Open a Figma file.
2. Select one or more top-level frames.
3. Name frames with all2html-style annotations such as:
   - `story:640`
   - `story:960`
   - `story:dynamic`
   - `story:image`
4. Run the imported all2html plugin.
5. Choose a preset and output format.
6. Export the ZIP bundle.

## What The UI Exports Today

The current plugin UI exports:

- `HTML`
- `Standalone HTML`

The plugin downloads a ZIP that includes:

- `ir.json`
- `manifest.json`
- emitted output files
- extracted assets

## Frame Rules

Figma follows a tighter selection contract than Illustrator:

- only selected top-level frames export
- frames with the same base name become a responsive group
- equal-width variants in the same group fail clearly

This is deliberate. It makes the export surface explicit instead of guessing.

## Config And Special Layers

The plugin keeps shared config in `figma.root` plugin data and local convenience state in `figma.clientStorage`.

The settings UI includes `Google Fonts` with `Off`, `CSS @import`, and `Link tag` modes. Figma text fonts are inferred into canonical font mappings automatically, and explicit config mappings still override the inferred mapping for the same `sourceFont`.

Top-level tagged child nodes inside a selected frame can define special layers:

- `:png`
- `:svg`
- `:svg:inline`
- `:video`
- `:html-before`
- `:html-after`

Figma's tag syntax is **not** the same as Illustrator's, even though the tag names look alike:

- Inline SVG is written `:svg:inline` here. Illustrator's `:svg,inline` and `:inline` do not match in Figma.
- Matching is case-insensitive and works as a prefix **or** a suffix of the node name.
- Only direct children of the selected frame are scanned.
- `:symbol` and `:div` are parsed and then rejected — they do nothing in Figma.

Frame names take a separate set of tokens: `:dynamic`, `:fixed`, `:image` (not `:image-only`), or a bare integer width override.

See the [Support Matrix](../reference/support-matrix.md) for the full per-surface tag comparison.

## What Figma Is Good For Right Now

- newsroom story frames
- responsive frame groups
- direct export from a UI instead of handwritten JSON
- special hooks and visual overlays

It is less about full-file auto-discovery and more about clean, selected export roots.
