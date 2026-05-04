---
title: How It Works
description: High-level architecture for all2html from input plugin to emitted output.
---

# How It Works

all2html has one central idea: every input surface should converge on the same intermediate format before rendering happens.

## The Flow

```text
Design tool or importer
→ canonical IR
→ core pipeline
→ emitter
→ output files
```

That means Illustrator, After Effects, Figma, and SVG import all target the same downstream contract instead of carrying their own private HTML renderers.

## Why The IR Matters

The canonical IR is the boundary between extraction and rendering.

- plugins/importers are responsible for understanding the source tool
- the core pipeline is responsible for normalization, grouping, and rendering prep
- emitters are responsible for writing HTML, Standalone HTML, Svelte, or React output

That keeps the output logic shared even when the source tools are very different.

## Read More

- [Canonical IR](canonical-ir.md)
- [Pipeline](pipeline.md)
- [Adapters And Extension Points](adapters.md)
- [Responsive Output](responsive-output.md)
- [Special Layers](special-layers.md)
