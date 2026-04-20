# IR (Intermediate Representation)

The IR is the contract between input plugins and the core. Plugins produce it, the core consumes it.

- `types.ts` — All TypeScript interfaces. Base types (`Document`, `Artboard`, `Layer`, `Element`) and pipeline phase types (`ResolvedDocument`, `StyledDocument`, `EmitterReadyDocument`).
- `schema.ts` — Zod schemas for runtime validation. Mirrors every type in `types.ts`.
- `validate.ts` — `loadAndValidateIR()` entry point. Throws `IRValidationError` with exact paths on failure.
- `defaults.ts` — Default settings values matching ai2html defaults.

## Rules

- `Document.irVersion` is required (`"0.0.0"` for pre-release). Will be used for forward/backward compatibility.
- `Document.settings` is `Partial<Settings>` (exporter may only set some). After `resolveSettings`, it becomes full `Settings` on `ResolvedDocument`.
- `Document.settings` uses canonical camelCase keys from `Settings` (`clickableLink`, `htmlOutputPath`, `inlineSvg`, etc.). Tool-native snake_case belongs only inside plugin-side parsing, never in emitted IR JSON.
- `renderAs` on TextElement uses `"html" | "image"` (not "htmlText"). Optional `renderAsReason` explains why (rotation, warp, pathText, imageOnly, setting).
- Elements use a discriminated union on `type`: `"text" | "shape" | "video" | "rawHtml" | "snippet"`.
- The enriched types (`StyledTextElement`, `EmitterReadyTextElement`, etc.) extend the base types — don't duplicate fields.
- Plugins must import and target these canonical IR types/schemas directly. Do not define shadow IR contracts in plugin code.
- The Figma plugin foundation imports `SettingsSchema`, `MetadataSchema`, and `FontMappingSchema` directly from `schema.ts` for config validation. Keep those schemas canonical and shared rather than cloning plugin-local variants.
- Accessibility metadata belongs in `Document.metadata` (`altText`, `imageAltText`, `ariaRole`), not in `Document.settings`.

## Unit conventions

- `letterSpacing` — em units (CSS-ready). Exporters convert from tool-native (e.g., Illustrator tracking / 1000, Figma px / fontSize).
- `opacity` (TextElement, ShapeElement, Layer, Color) — 0-100 integer scale. Core converts to CSS 0-1.
- `fontSize`, `leading`, `spaceBefore`, `spaceAfter` — pixels.
- All positions — absolute pixels, top-left origin, per-artboard coordinate space.

## Validation

- `Paragraph.text` must equal concatenation of `runs[].text` (Zod refine).
- `Asset` record keys must equal `asset.id`.
- `Asset.exportParams.format` is enum: `"png" | "png24" | "jpg" | "svg"`.
- `Paragraph.direction` is optional: `"ltr" | "rtl"` (defaults to "ltr" when omitted).
- `Metadata.lang` is optional: BCP 47 language tag (e.g., "en", "ja").
