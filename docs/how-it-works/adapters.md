---
title: Adapters And Extension Points
description: How new source tools, browser surfaces, and emitters connect to the shared all2html pipeline.
---

# Adapters And Extension Points

all2html is structured so new surfaces can reuse the same contracts instead of forking rendering logic.

## Adapter Responsibilities

An adapter owns source-tool behavior:

- finding source documents, frames, layers, or files
- translating tool-native objects into canonical IR
- assigning stable artboard and layer IDs
- attaching source metadata for traceability
- returning imported asset files when raster or extracted assets are needed

The adapter should stop at the IR boundary. The shared core handles settings resolution, grouping, styling, and emitter-ready preparation.

## ID Rules

Canonical IDs are part of the adapter contract:

- artboard IDs must be stable and unique inside the document
- layer IDs must be stable and unique inside their artboard
- asset `artboardId` and `layerId` values must reference those canonical IDs
- source-native IDs are preferred when a host provides them
- file importers should include path context, not just basenames, to avoid collisions

Source-native labels, original names, and host metadata belong in `source`, not in ID-dependent lookup fields.

## Importer Registry

Node-capable importers use the importer registry. Built-in importers and internal future importers are registered through the same `registerImporter` path.

This is intentionally an internal registry for now. Pre-release all2html should keep third-party plugin loading out of scope until the IR and bundle contracts are stable enough to support it.

## Emitter Registry

Emitters write web-facing output from emitter-ready documents. Built-in HTML, Standalone HTML, Svelte, and React emitters use the emitter registry, and internal future emitters can use `registerEmitter`.

Browser-safe emitters use `registerBrowserEmitter` so browser apps do not accidentally pull in Node-only dependencies.

## Browser SDK

Browser apps can use the browser entry points to avoid duplicating orchestration code. The SVG converter uses `convertLoadedSvgFilesInBrowser` to import files, process IR, emit output, build a bundle, and return UI-ready summary data.

That split is what keeps web apps, bookmarklets, Tampermonkey scripts, or custom design apps from needing to know the entire pipeline.

## Host Apps

Extension-driven tools such as Illustrator, After Effects, Figma, and similar apps should treat all2html as a shared conversion core.

Host-specific code should stay focused on:

- permissions and install model
- document selection
- host API extraction
- panel or plugin UI
- file writing and download behavior

The portable contract is still canonical IR plus the common output bundle.

## Library Direction

For custom Svelte design apps or other web-native tools, the clean path is a library-style adapter that emits canonical IR directly and calls the browser SDK. That avoids pretending every integration is a design-tool plugin while still sharing emitters, settings, bundles, and validation.
