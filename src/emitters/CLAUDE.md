# Emitters

Emitters take an `EmitterReadyDocument` and produce output in a specific format.

## Registry (`registry.ts`)

Emitters are registered in an internal `Map` through `registerEmitter`. Built-ins use the same path as future internal emitters. Each descriptor has `emitAll(doc, groups)` returning `{ files: EmitFile[], warnings }`. The CLI uses `getEmitter(format)` for dispatch — no if/else chain. `perGroup()` helper handles the group loop for group-aware emitters (HTML, Svelte, React). Standalone ignores groups and always produces one file. Extensions are normalized (leading dot ensured).
Common emitter options must be wired end-to-end through the registry; don't leave typed options as dead config.

## HTML emitter (`html.ts`)

CRITICAL: Keep output in sync with `html-string.ts`. Both must produce byte-identical output.

Builds a real hast tree using `hastscript`, serializes with `hast-util-to-html`. Custom code blocks injected as raw nodes (`allowDangerousHtml: true`).

Renders all element types: TextElement, ShapeElement (symbols/divs), VideoElement, RawHtmlElement, SVG layers, PNG layers.

Supports multi-file output via `EmitGroupOptions` parameter (subset of artboards + slug override).

## HTML string emitter (`html-string.ts`)

CRITICAL: Keep output in sync with `html.ts`. Byte-identical output required.

Pure string concatenation, no npm dependencies. Used in the ExtendScript bundle. Same `EmitGroupOptions` support.

## Svelte emitter (`svelte.ts`)

Wraps HTML in a Svelte 5 component with `$props()`. Extracts CSS into `<style>` block. Replaces image `src` with `{assetsPath}` prop interpolation.

## React emitter (`react.ts`)

Wraps HTML in a React functional component. `className` instead of `class`. `assetsPath` prop. CSS via `dangerouslySetInnerHTML` on `<style>`.

## Standalone emitter (`standalone.ts`)

Full HTML document. Supports `local_preview_template` setting via the template system.

## Shared utilities (`shared/`)

- `css.ts` — All CSS generation. Container queries, artboard styles (with `aspect-ratio` for dynamic), text style classes. Scoped to `#{ns}{slug}-box`.
- `hast-helpers.ts` — `h()`, `raw()`, `commentNode()`, `escapeAttr()`, `escapeHtml()`.
- `assets.ts` — Asset indexing by canonical `artboardId`/`layerId`, `resolveAssetPath()` (static), `tokenizedAssetPath()` (with `%%ASSET_PATH%%`), `replaceAssetPathToken()`.
- `options.ts` — Applies shared emitter options (`allowUnsafeHtml`, `positionMode`) before rendering.
- `replaceable-nodes.ts` — Extracts snippets and bindings from EmitterReadyDocument. Accepts `{ allowUnsafeHtml }` option to gate `binding.allowHtml`.

## Svelte/React emitter rules

- Asset paths use `__ALL2HTML_ASSETS__` token in the HTML string, replaced at runtime
- Do NOT convert `class` → `className` in HTML strings (they're plain HTML inside dangerouslySetInnerHTML)
- Strip trailing slashes from `assetsPath` before replacement to avoid double-slash paths
- Component names must be valid JS identifiers (prefix with "Graphic" if slug starts with a digit)
- Token regex must cover `src`, `data-src`, and video extensions (mp4, webm) not just images

## Rules

- Always use `escapeAttr()` for attribute values, `escapeHtml()` for text content
- CSS properties output in alphabetical order for determinism
- Use `raw()` only for intentionally unescaped content (custom blocks, pre-escaped text)
- Pre-index assets with `buildScopedAssetIndex()` for O(1) canonical ID lookups — don't use `Object.values().find()` in loops
- Grouped output must use the same effective slug for DOM IDs and generated CSS selectors
- Shape elements use `EmitterReadyShapeElement` type — no `as any`
- Escape video URLs with `escapeAttr()` in string emitter
- Sanitize artboard names in HTML comments (strip `-->` sequences)
