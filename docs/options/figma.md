---
title: Figma
description: Figma manifest-import workflow, export model, and current plugin behavior.
---

# Figma

The Figma plugin works well now and fits the same pipeline as the other surfaces.

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

Top-level tagged child nodes inside a selected frame can define special layers with the Illustrator-aligned naming contract:

- `:png`
- `:svg`
- `:svg:inline`
- `:video`
- `:html-before`
- `:html-after`

## What Figma Is Good For Right Now

- newsroom story frames
- responsive frame groups
- direct export from a UI instead of handwritten JSON
- special hooks and visual overlays

It is less about full-file auto-discovery and more about clean, selected export roots.

> Screenshot placeholder
> Crop the Figma plugin UI showing the selection summary, preset selector, and export format controls.
