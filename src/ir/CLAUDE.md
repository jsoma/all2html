# IR (Intermediate Representation)

The IR is the contract between input plugins and the core. Plugins produce it, the core consumes it.

- `types.ts` — All TypeScript interfaces. Base types (`Document`, `Artboard`, `Layer`, `Element`) and pipeline phase types (`PhaseDocument<P>` and its aliases `ResolvedDocument`, `BreakpointedDocument`, `StyledDocument`, `DeduplicatedDocument`, `EmitterReadyDocument`).
- `schema.ts` — Zod schemas for runtime validation. Mirrors every type in `types.ts`.
- `validate.ts` — `loadAndValidateIR()` entry point. Throws `IRValidationError` with exact paths on failure.
- `defaults.ts` — Default settings values matching ai2html defaults.
- `settings-definitions.ts` — The setting list: key, kind, default, range. Ships inside the ExtendScript bundle.
- `setting-help.ts` — Panel and docs help copy, keyed by setting. A deliberate sibling of `settings-definitions.ts`: nothing in `src/extendscript/` imports it, so the prose stays out of the Illustrator bundle. Do not move `help` back onto `SettingDefinition`.

## Rules

- `Document.irVersion` is required (`"0.1.0"` for the current pre-release IR). The schema currently accepts only the current version.
- `Document.source` is required and identifies the source tool/adapter. Source-native names and IDs belong in `source`, not in ad-hoc top-level fields.
- `Artboard.id` and `Layer.id` are required stable canonical IDs. Assets reference these through `artboardId` and `layerId`.
- `Document.settings` is `Partial<Settings>` (exporter may only set some). After `resolveSettings`, it becomes full `Settings` on `ResolvedDocument`.
- `Document.settings` uses canonical camelCase keys from `Settings` (`clickableLink`, `htmlOutputPath`, `inlineSvg`, etc.). Tool-native snake_case belongs only inside plugin-side parsing, never in emitted IR JSON.
- `renderAs` on TextElement uses `"html" | "image"` (not "htmlText"). Optional `renderAsReason` explains why (rotation, warp, pathText, imageOnly, setting).
- Elements use a discriminated union on `type`: `"text" | "shape" | "video" | "rawHtml" | "snippet"`.
- The enriched types (`StyledTextElement`, `EmitterReadyTextElement`, etc.) extend the base types — don't duplicate fields.
- Pipeline phases are **exclusive, not additive**. `PhaseDocument<P>` carries a `pipelinePhase` literal and selects its artboard/layer/element types from it, so no phase is structurally assignable to another. Adding a phase means adding a member to `PipelinePhase` and `PhaseArtboards`, not adding another optional field.
- Phase documents are internal and are never serialized. `Document.pipelinePhase` is declared `?: never` as a type-level marker only; it is absent from `DocumentSchema` and from every persisted `ir.json`.
- Each phase must make the previous phase's uncertainty unrepresentable: `breakpoint` does not exist before `BreakpointedArtboard`, `computed*Styles` before `StyledTextElement`, class names before `DeduplicatedTextElement`, or `computedPosition` before `EmitterReadyTextElement`. Never insert a placeholder to satisfy a later phase.
- `TextElement` is a union of `HtmlTextElement` and `ImageTextElement`, discriminated by the existing `renderAs` field. Image-rendered text is baked into the background raster, so no transform touches it — this is modelled, not cast around.
- `EmitterReadyLayer.elements` admits only processed variants. Do not re-add raw `ShapeElement` / `SnippetElement`: that is what forces `"computedShapePosition" in el` probes back into the emitters.
- `Artboard.relationship` is **not** a field. It was declared and validated with zero consumers, and was removed under D16/D27; the alternates-vs-sequence distinction returns with its named replacement, `groupArtboards`. That module is ES3-safe as of the multi-file work, so the D19 blocker is gone; the missing piece is the behavior itself (sequence = show all, in order — a breakpoint/emitter change, not a grouping one). Do not re-add it without a consumer that changes observable output.
- Plugins must import and target these canonical IR types/schemas directly. Do not define shadow IR contracts in plugin code.
- Zod-free surfaces validate setting values through `isValidSettingValue()` from `settings-definitions.ts`; it derives enum/range/type/identifier rules from the same definitions that build `SettingsSchema`. Do not add another per-setting validator in an exporter.
- The Figma plugin foundation imports `SettingsSchema`, `MetadataSchema`, and `FontMappingSchema` directly from `schema.ts` for config validation. Keep those schemas canonical and shared rather than cloning plugin-local variants.
- Accessibility metadata belongs in `Document.metadata` (`altText`, `imageAltText`, `ariaRole`), not in `Document.settings`.
- Font mappings use `sourceFont` as the canonical source-tool key. Keep `aifont` only in explicit compatibility adapters.

## Unit conventions

- `letterSpacing` — em units (CSS-ready). Exporters convert from tool-native (e.g., Illustrator tracking / 1000, Figma px / fontSize).
- `opacity` (TextElement, ShapeElement, Layer, Color) — 0-100 integer scale. Core converts to CSS 0-1.
- `fontSize`, `leading`, `spaceBefore`, `spaceAfter` — pixels.
- All positions — absolute pixels, top-left origin, per-artboard coordinate space.

## Validation

- `Paragraph.text` must equal concatenation of `runs[].text` (Zod refine).
- `Asset` record keys must equal `asset.id`.
- `Asset.artboardId` and `Asset.layerId` refer to canonical IDs, not source-tool display names.
- Duplicate artboard IDs are invalid.
- Duplicate layer IDs inside one artboard are invalid.
- Assets that reference unknown artboard/layer IDs are invalid.
- `Asset.exportParams.format` is enum: `"png" | "png24" | "jpg" | "svg"`.
- `Paragraph.direction` is optional: `"ltr" | "rtl"` (defaults to "ltr" when omitted).
- `Metadata.lang` is optional: BCP 47 language tag (e.g., "en", "ja").
