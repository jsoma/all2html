# Figma Plugin

The Figma plugin should feel usable to newsroom designers, not just developers. It still exports canonical IR first and then reuses the shared core pipeline and emitters.

## Rules

- Do not define local IR document/artboard interfaces. Import canonical types from `src/ir/`.
- Build canonical artboard/layer IDs through `src/ir-ids.ts`; do not hand-roll IDs in extraction/export code.
- Selection contract is strict: selected top-level frames only.
- The layer-tag parser must not recognize a tag the runtime refuses. `:symbol` / `:div` resolve to `default` with an `unsupportedToken`, which `discoverTopLevelSpecialLayerNodes` turns into an explicit "not supported on Figma" warning. Frame tokens accept both `image-only` (documented) and `image` (older spelling).
- Same base frame name = responsive group. Duplicate widths inside a group are an error, not a fallback case.
- Keep Figma-specific details in extraction metadata only. Do not add Figma-only fields to public IR without a proven cross-tool need.
- JSONC config should stay small and canonical: `settings`, `metadata`, `fonts`, `customBlocks`, `emit`.
- `emit` is the canonical `EmitterConfigSchema` from `src/emitters/types.ts` — the identical block the CLI reads from `all2html.config.json`. It is the only route to shipped emitter behavior (`positionMode`, `allowUnsafeHtml`, `responsiveImageMode`), so `buildExportBundle` must keep passing it into `emitAll`. No direct control edits it; `cloneConfig` in `ui.ts` has to carry it through or a form edit deletes it.
- Extracted asset `path` values are **relative to `settings.imageOutputPath`**, exactly like Illustrator and the SVG importer. The output directory is applied twice and the two must agree: `resolveAssetPath()` prefixes it into the emitted `src`, `createOutputBundle({ assetRoot })` prefixes it into the ZIP layout. Never bake a directory into the asset path.
- Shared config is stored on `figma.root`. Local convenience state belongs in `figma.clientStorage`.
- Direct controls are the primary UX. Keep the always-visible surface minimal, use presets for common newsroom workflows, and keep rarer controls inside `More settings`.
- Advanced JSONC is a secondary view onto the same canonical config, not a separate model.
- Invalid JSONC must block save/export with actionable copy.
- Warnings are product UX. Do not hide them behind counts or console-only output.
- ZIP delivery is the plugin boundary. Bundles include `ir.json`, `manifest.json`, emitted files, and extracted assets. The core still only thinks in IR documents and emitted files until bundle assembly.
- Do not add a Figma-only HTML renderer. All Figma output must pass through `processDocument()` and the existing emitters.
- The runnable plugin path uses a browser-safe pipeline chain (`loadAndValidateIR` → `resolveSettingsPure` → core transforms) instead of the Node CLI entrypoint.
- Do not call Figma “supported” in user-facing docs until the live hardening corpus and typical-newsroom-file QA bar are actually satisfied.

## Key Files

- `src/extract/frames.ts` — selection validation, frame name parsing, responsive grouping
- `src/extract/layers.ts` — canonical layer-type parsing only
- `src/extract/text.ts` — styled text segment → canonical runs/paragraphs
- `src/ir-builder.ts` — extracted Figma data → canonical `Document`
- `src/config.ts` — JSONC config parsing/validation
- `src/messages.ts` — typed sandbox/UI message contract
- `src/persistence.ts` — root plugin-data + clientStorage persistence helpers
- `src/runtime-extract.ts` — real Figma frame cloning, text extraction, and background asset export
- `src/export.ts` — pipeline/emitter bundling + ZIP archive assembly
- `src/main.ts` — thin sandbox-side orchestration entrypoints
- `src/ui.ts` / `src/ui-entry.ts` / `src/ui.html` — supportable UI state, browser controller, and template
