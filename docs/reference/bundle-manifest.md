---
title: Bundle Manifest
description: The machine-readable inventory included with exported all2html bundles.
---

# Bundle Manifest

Most export surfaces produce an output bundle. Each bundle includes `manifest.json` so downstream tools can inspect the output without guessing filenames or parsing HTML.

## Shape

```json
{
  "schemaVersion": "0.1.0",
  "createdAt": "2026-04-28T00:00:00.000Z",
  "source": {
    "tool": "svg",
    "name": "photo-card"
  },
  "irVersion": "0.1.0",
  "slug": "photo-card",
  "emittedFormat": "html",
  "warnings": [],
  "files": [
    {
      "path": "ir.json",
      "mimeType": "application/json",
      "role": "source-ir",
      "bytes": 1234
    }
  ]
}
```

## File Roles

- `source-ir`: the canonical `ir.json` used for the export
- `emitted`: generated HTML, Svelte, React, or other web output
- `asset`: raster, SVG, or other extracted asset files
- `manifest`: the manifest file itself

## Rules

- Paths are normalized to bundle-relative POSIX-style paths.
- `files` includes `manifest.json`, including the manifest file's own byte size.
- `source` mirrors `Document.source`.
- `irVersion` mirrors `Document.irVersion`.
- `warnings` combines import, processing, and emitter warnings when the surface provides them.
- The serialized `manifest.json` must match the in-memory manifest returned by bundle helpers.
