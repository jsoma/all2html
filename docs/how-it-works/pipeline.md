---
title: Pipeline
description: The shared processing steps between IR input and emitted output.
---

# Pipeline

Once a tool has produced canonical IR, the same core pipeline takes over.

## Processing Stages

### 1. Validate

The IR is checked against the shared schema. This is where malformed JSON, invalid enum values, or structural mismatches fail early.

Importers are expected to provide canonical IDs and source metadata before this point.

### 2. Resolve Settings

The pipeline turns partial settings into a full resolved settings object using canonical defaults plus any inline or external config.

### 3. Group Artboards

Artboards are grouped into responsive sets when their names or input metadata indicate that they belong together.

### 4. Compute Render-Ready Values

This is where the core prepares the document for emitters:

- breakpoints
- responsive behavior
- text/style normalization
- asset path behavior
- emitter-ready layer structure

### 5. Emit

Finally, an emitter writes output files:

- HTML fragment
- Standalone HTML
- Svelte component
- React component

Export surfaces can then wrap the emitted files, `ir.json`, assets, warnings, and `manifest.json` into a common bundle.

The pipeline is shared so that importers and plugins do not each reinvent rendering.

## Why This Split Is Useful

It lets you:

- add new input surfaces without rewriting emitters
- add new emitters without touching source-tool extraction
- inspect `ir.json` and debug failures at a stable boundary
- inspect `manifest.json` to understand what a bundle contains
