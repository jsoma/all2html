# Capability Matrix

**What each surface actually honors.** Derived by tracing every setting from where it enters to where it is consumed, cross-checked against tracked artifacts in `data/all2html-output/`. This is evidence, not intent — where it disagrees with `docs/`, the docs are wrong.

Cell vocabulary:

- **yes** — verifiably read and acted on
- **no** — the surface never reads it
- **DEAD** — the surface exposes a control or accepts the value but does **not** act on it
- **n/a** — meaningless for that surface

Columns: **IL** = Illustrator script/panel · **AE** = After Effects · **FIG** = Figma plugin · **CLI/SVG** = Node CLI + browser dropzone.

> **31 DEAD cells recorded; 29 still dead.** Every one is a place where a user sets something, the export succeeds, and nothing happens. Two are closed rather than declared: **D10** (`output` on Illustrator) — `group-artboards.ts` is ES3-safe now, `src/extendscript/index.ts` calls it, and `exporter.jsx` writes one file per group — and **D31** (`useLazyLoader` on video), which `src/emitters/shared/lazy-video.ts` fixed by shipping the loader on all four formats. Matrix footnote 7 (Figma `imageOutputPath`) closed in the same pass and was never a numbered cell. This is still the single largest source of user-visible wrongness in the product, and it is the reason SPEC §12.5 (capability declarations) leads the contract work.
>
> **STATUS: seeded into code.** D1–D30 minus D10 are declared in `src/core/capabilities.ts` and warn at export time with the `setting:unsupported` code. `test/unit/capabilities.test.ts` transcribes the table below (by D-id), asserts the list is exactly 29 entries long, and fails if any of them stops warning; it also re-derives the "zero readers" claims for `writeImageFiles`, `inlineSvg`, `svgIdPrefix` and `createPromoImage` from the source tree, so the matrix cannot silently drift from the code. The count appears in three places — this header, that assertion, and the Known Broken bullet in the root `CLAUDE.md` — and all three must move together. Changing a cell here means changing the declaration.
>
> **The public docs are generated from the declarations.** `docs/reference/settings.md` and `docs/reference/support-matrix.md` are emitted by `scripts/generate-settings-docs.ts` from `SETTING_DEFINITIONS`, `SURFACE_CAPABILITIES`, and `SURFACE_FEATURES` — never hand-edited. `pnpm check:generated-docs` runs in CI and fails when the committed pages no longer match the declarations, so changing a cell here changes the declaration, and changing the declaration changes the public page in the same commit.
>
> **The check compares the request against the surface, not against the default.** An earlier version suppressed the warning whenever the resolved value equalled the *global* default, which proves nothing about what the surface implements. It was wrong in both directions on Figma: `use2xImages` omitted or set to `true` was silent while the export was 1x, and `use2xImages: false` — the only value Figma actually produces — warned. A surface now declares `divergesAtDefault` wherever its real behavior differs from the documented default, and the checker warns whenever the request is not what will be produced. Consequence: three Figma cells (`pngTransparent`, `pngNumberOfColors`, `use2xImages`) warn on **every** export, untouched settings included, because the promised defaults are not what Figma does. Everywhere else an untouched export stays silent, and `test/unit/capabilities.test.ts` pins that list so the noise budget is a reviewed decision rather than a drift.
>
> **After Effects is declared but not enforced.** `afterEffectsCapabilities` carries `runtimeChecked: false`. The AE exporter does now load a bundle — `dist/extendscript/all2html-ae-core.js`, the helper-only entry D13 added to retire its forked google-fonts and escaping copies — but that bundle deliberately exports no pipeline and no checker, so nothing there can call `checkSurfaceCapabilities`: an AE config carrying `{"settings":{"imageFormat":["svg"]}}` is still ignored with no warning. Enforcing it means putting AE on the *pipeline* (SPEC §12.8 / the temporal scene work), which is a different and much larger change than the bundle slot, not an edit to this table. The four other surfaces are enforced, and `test/unit/capabilities.test.ts` asserts the flag, the call site, and that neither the AE exporter nor its bundle entry reaches the checker.

---

## Table A — Settings × Surface

| # | Setting | IL | AE | FIG | CLI/SVG |
|---|---|---|---|---|---|
| 1 | `imageFormat` | **DEAD** except jpg [D1] | no | **DEAD** except auto/png24 [D2] | yes¹ |
| 2 | `writeImageFiles` | **DEAD** [D3] | no | **DEAD** [D4] | **DEAD** [D5] |
| 3 | `pngTransparent` | yes `illustrator/exporter.jsx#exportArtboardImage` | no | **DEAD at default** [D6] | yes² |
| 4 | `pngNumberOfColors` | yes `illustrator/exporter.jsx#exportArtboardImage` | no | **DEAD at default** [D7] | yes² |
| 5 | `jpgQuality` | yes `illustrator/exporter.jsx#exportArtboardImage` | no | **DEAD** [D8] | yes² |
| 6 | `use2xImages` | yes `illustrator/exporter.jsx#exportArtboardImage` | no | **DEAD at default** [D9] | yes² |
| 7 | `cacheBustToken` | yes `shared/assets.ts#resolveAssetPath` | no | yes | yes |
| 8 | `namespace` | yes `html-tree.ts#namespace` | no | yes³ | yes |
| 9 | `projectName` | yes `illustrator/exporter.jsx#project_name` | no | yes `figma/src/main.ts#projectName` | yes |
| 10 | `output` | yes [D10 fixed] | no | yes⁴ | yes⁴ |
| 11 | `htmlOutputPath` | yes `illustrator/exporter.jsx#resolveDocumentOutputPath` | no | **DEAD** [D11] | **DEAD** [D12] |
| 12 | `htmlOutputExtension` | yes — `extendscript/index.ts` stamps it on every emitted file record, `exporter.jsx` writes `slug + extension` | no | yes⁵ | yes⁵ |
| 13 | `imageOutputPath` | yes⁶ | no | yes⁷ | yes |
| 14 | `imageSourcePath` | yes `shared/assets.ts#resolveAssetPath` | no | yes³ | yes |
| 15 | `responsiveness` | yes `compute-breakpoints.ts#responsiveness` | no | yes | yes |
| 16 | `textResponsiveness` | yes `compute-positions.ts#textResponsiveness` | no | yes³ | yes |
| 17 | `maxWidth` | yes `shared/css.ts#maxWidth` | no | yes³ | yes |
| 18 | `centerHtmlOutput` | yes `shared/css.ts#centerHtmlOutput` | no | yes | yes |
| 19 | `renderTextAs` | yes `illustrator/exporter.jsx#renderTextAs` | no | **DEAD** [D13] | yes² |
| 20 | `renderRotatedSkewedTextAs` | yes `illustrator/exporter.jsx#renderRotatedSkewedTextAs` | no | **DEAD** [D14] | **DEAD** [D15] |
| 21 | `googleFonts` | yes `shared/css.ts#googleFonts` | **yes** `after-effects/exporter.jsx#getGoogleFontsMode` | yes | yes |
| 22 | `testingMode` | yes `shared/css.ts#testingMode` | no | yes³ | yes |
| 23 | `includeResizerCss` | yes `shared/css.ts#includeResizerCss` | no | yes³ | yes |
| 24 | `includeResizerWidths` | yes `html-tree.ts#includeResizerWidths` | no | yes³ | yes |
| 25 | `responsiveImageMode` | **no** [N1] | no | yes `shared/css.ts#responsiveImageMode` | yes |
| 26 | `useLazyLoader` | yes⁸ | no | yes⁸ | yes⁸ |
| 27 | `inlineSvg` (setting) | **DEAD** [D16] | no | **DEAD** [D17] | **DEAD** [D18] |
| 28 | `svgIdPrefix` | **DEAD** [D19] | no | **DEAD** [D20] | **DEAD** [D21] |
| 29 | `svgEmbedImages` | yes `illustrator/exporter.jsx#exportSvgLayer` | no | **DEAD** [D22] | **DEAD** [D23] |
| 30 | `clickableLink` | yes `html-tree.ts#clickableLink` | no | yes³ | yes |
| 31 | `createPromoImage` | yes `illustrator/exporter.jsx#create_promo_image` | no | **DEAD** [D24] | **DEAD** [D25] |
| 32 | `promoImageWidth` | yes⁹ | no | **DEAD** [D26] | **DEAD** [D27] |
| 33 | `localPreviewTemplate` | **DEAD** [D28] | no | **DEAD** [D29] | yes (CLI) / **DEAD** (browser) [D30] |

### Footnotes

1. Honored only on `import svg` (`import-core.ts#resolveBackgroundImageFormat`). The value `svg` is explicitly rejected with a warning and downgraded to png in that same function — an honest refusal, not a dead cell. `render <ir.json>` never rasterizes, so the key is inert there.
2. Same: honored on `import svg`, inert on `render`.
3. Accepted only via Advanced JSONC (`plugins/figma/src/config.ts#SettingsSchema` → the canonical schema); no dedicated UI control. Honored because the core pipeline reads it.
4. Honored for every format the surface can emit. `standalone` used to collapse to one file because its registry entry discarded `groups`; it now runs through the same `perGroup` helper as html/svelte/react (`registry-shared.ts#perGroup`).
5. `html` only. The other formats write their own extension — `.svelte`, `.jsx`/`.tsx`, `.html` for standalone — declared per format as `producedByFormat`, so the checker compares the request against what the chosen format actually writes rather than against the global default. A non-default extension warns naming what the format writes instead; the untouched `.html` default stays silent, because choosing `--format react` is itself the decision that dictates `.jsx`.
6. Only a *fallback* for the whole output dir: `resolveDocumentOutputPath` reads it only when `html_output_path` is absent (`illustrator/exporter.jsx#resolveDocumentOutputPath`), and images are then written under that one `settings.outputPath` (`illustrator/exporter.jsx#exportImages`), so it cannot relocate images independently of HTML.
7. **Fixed.** Was: the value moved the `<img src>` prefix while `plugins/figma/src/export.ts` omitted `assetRoot`, so any non-default value desynced the HTML from the ZIP layout. `figma/src/export.ts#assetRoot` now derives it from `document.settings.imageOutputPath` and passes it into `createOutputBundle`, so the emitted `src` and the ZIP entry are derived from one value. The `partial` declaration is deleted — Figma's `defaultStatus` is `honored`. Pinned by `test/unit/figma-plugin.test.ts` ("keeps HTML src paths and ZIP entries in sync").
8. Images get native `loading="lazy"`. Videos used to get `data-src` and no `src` with no loader anywhere in `src/`, which is D31; `src/emitters/shared/lazy-video.ts` now ships the loader on all four formats — a `<script>` for html/standalone, a lifecycle effect for svelte/react — so the setting is honored end to end.
9. Read from the raw snake_case `promo_image_width` on `docSettings` (`illustrator/exporter.jsx#promo_image_width`), not the canonical setting. Reachable via text block / config file only; the panel cannot set it.

### DEAD-cell evidence

| ID | Accepted at | Not honored — proof |
|---|---|---|
| D1 | `illustrator/exporter.jsx#buildCanonicalIrSettings` reads `image_format`; panel select at `ImageSettings.svelte:59` — it still lists all 5 values, but `gateOptions()` (`panel/src/js/capability.ts:110`) now renders `png24` and `svg` disabled and labelled "not supported", so a stored value displays without being newly selectable | `illustrator/exporter.jsx#exportArtboardImage` — only branch is `if (format === "jpg") … else PNG8`. Artifact: `mask-test/ir.json` has `"imageFormat":["svg"]` → output is `PNG image data, 8-bit colormap` while `exportParams.format` records `"svg"`. |
| D2 | `ui.html#imageFormat` (auto/png/png24/jpg/svg) | every `exportAsync` call in `figma/src/runtime-extract.ts` hardcodes its format. Zero readers of `settings.imageFormat` in `src/emitters` or `src/core`. What it hardcodes is `exportAsync({format:"PNG"})`, i.e. full-color PNG with alpha, so `auto` and `png24` are honored by accident and only `png` (8-bit), `jpg` and `svg` are dead. |
| D3 | `illustrator/exporter.jsx#write_image_files`; `panel/src/js/adapter.ts#writeImageFiles` | Zero readers in `src/`. `illustrator/exporter.jsx#exportImages` is called unconditionally. |
| D4 | `figma/src/config.ts#SettingsSchema` | Zero readers; assets always written to ZIP. |
| D5 | `ir.json` settings | Zero readers; `cli/index.ts#createOutputBundle` writes assets unconditionally. |
| D6–D9 | `figma/src/config.ts#SettingsSchema` | Figma hardcodes transparency, has no quantizer, never emits JPEG, and sets no `constraint` on any `exportAsync`, so the documented default `{type:"SCALE",value:1}` applies (`ExportSettingsImage` in `@figma/plugin-typings`; the recorded params are `runtime-extract.ts:350`). D6, D7 and D9 diverge **at the default**: the defaults promise opaque, 128-color, 2x, and Figma produces alpha, full-color, 1x, so all three warn on every export. D8 does not: Figma never emits JPEG at all, so `jpgQuality` is unobservable rather than wrong and warns only when the user moves it. |
| D10 | Panel select `MainSettings.svelte#output`; `illustrator/exporter.jsx#buildCanonicalIrSettings` | **Fixed.** Was: `src/extendscript/index.ts` never imported `group-artboards` (it uses two `Map`s, which the bundle guard forbids) and `processAndEmit` ended in a single `emitHTMLString`, so `multiple-files-test/ir.json` with two base names produced exactly **1** `.html`. Now: `groupArtboards` accumulates into plain objects, `processAndEmit` returns `files[]` (one per group), and `exporter.jsx` writes each. Pinned by `test/integration/surface-entrypoints.test.ts`, which drives the shipped bundle. |
| D11–D12 | `figma/src/config.ts#SettingsSchema` / `ir.json` | Zero readers; Figma delivers a ZIP, CLI uses `-o` only. Verified with a fixture carrying `htmlOutputPath`. |
| D13 | `ui.html#renderTextAs`; also set by the `image-only-graphic` preset (`figma/src/ui.ts#getPresetControls`) | `figma/src/runtime-extract.ts#extractTextElement` hardcodes `renderAs:"html"`; text is always hidden before raster (`runtime-extract.ts#hideTextNodes`). |
| D14–D15 | `ui.html#renderRotatedSkewedTextAs` / `ir.json` | Zero references in `src/`; honored only by `illustrator/exporter.jsx#renderRotatedSkewedTextAs`. |
| D16–D18 | `AdvancedSettings.svelte#inlineSvg`; `figma/src/config.ts#SettingsSchema` | No reader of `settings.inlineSvg` anywhere. Emitters read only the **per-layer** flag (`html-tree.ts#inlineSvg`). |
| D19–D21 | `AdvancedSettings.svelte#svgIdPrefix`; `illustrator/exporter.jsx#svg_id_prefix` | Zero readers. The only prefixing implementation was `src/core/svg-postprocess.ts`, which had **zero importers repo-wide**; it was deleted under D16 and nothing replaces it. All four surfaces declare `unsupported`, so the setting warns instead of no-opping. |
| D22–D23 | `figma/src/config.ts#SettingsSchema` / `ir.json` | Zero readers; `figma/src/runtime-extract.ts#extractSpecialLayer` exports SVG with no embed option. |
| D24–D27 | `figma/src/config.ts#SettingsSchema` / `ir.json` | Zero implementation references outside the type and definition files. |
| D28 | `illustrator/exporter.jsx#local_preview_template` | Only consumer is `standalone.ts#localPreviewTemplate`; `src/extendscript/index.ts#emitHTMLString` is the only emitter Illustrator imports and it never touches the registry, so standalone is unreachable from Illustrator. |
| D29–D30 | `figma/src/config.ts#SettingsSchema` / dropzone upload | The browser standalone emitter has no filesystem to read a template from, and `standalone-browser.ts` therefore never mentions the setting at all; the capability declaration (`capabilities.ts#BROWSER_PREVIEW_TEMPLATE`) is what warns. |
| D31 | Default `true` (`settings-definitions.ts`), every surface | **Fixed.** Was: the video arm emitted `data-src` with no `src` and zero hits for `IntersectionObserver` / `lazyload` / `loadImages` existed in `src/`, so a lazily-loaded video never played. Now `src/emitters/shared/lazy-video.ts` is the single source for the loader — html/standalone get an `IntersectionObserver` `<script>`, svelte/react get the equivalent lifecycle effect — and the `warnedByEmitter` declaration is deleted along with the per-layer warning. Images were never affected (native `loading="lazy"`). |

**Asset records are part of the claim.** D1's evidence is an `exportParams.format` recording `svg` over PNG8 bytes — a surface describing its own output wrongly. Figma had the same defect in the other direction: `runtime-extract.ts` stamped `{format:"png", scale:1, transparent:false}` on bytes that are full-color PNG with alpha, contradicting the declaration added beside it. The record now names what `exportAsync({format:"PNG"})` actually produces — `png24`, `scale:1`, `transparent:true` — and `test/unit/figma-runtime.test.ts` asserts the record and `figmaCapabilities` agree on all three, so the two cannot drift apart again. An `exportParams` that misdescribes its bytes is a declaration defect, not a cosmetic one: it is the only machine-readable statement of what a downstream consumer received.

**Declaration note.** `imageFormat` on Illustrator is declared `partial` rather than `unsupported`, because `jpg` *is* honored (`illustrator/exporter.jsx#exportArtboardImage`); only `png24` and `svg` fall back to 8-bit PNG, and only those warn. `imageFormat` on Figma is `partial` for the same reason: `figma/src/runtime-extract.ts#exportAsync` is always called with `{format:"PNG"}`, which produces full-color PNG with alpha — exactly `png24` — so `auto` and `png24` land where the user asked and `png` (8-bit), `jpg` and `svg` warn. Warning about a value the surface does produce is the same defect as staying silent about one it does not. Likewise the CLI's rasterization settings are declared `partial` with `paths: ["import"]`, so they warn on `render` and stay silent on `import svg` — footnotes 1 and 2, made executable. `localPreviewTemplate` (D30) is the one place the browser dropzone genuinely diverges from the Node CLI, so `browser` is its own declaration rather than an alias of `cli`.

**Content-dependent cells warn from the emitter — currently a seam with no occupant.** `SettingSupport.warnedByEmitter` exists for the case where a setting is honored for some document content and dead for other content, which a settings-only check cannot decide. D31 (`useLazyLoader`: honored for images, dead for video) was the one live user, and it was fixed rather than declared, so **no declaration carries the field today**. The field and the checker's `continue` on it are kept deliberately: the shape of the problem recurs, and re-deriving it under time pressure is how content-dependent gaps get mis-declared as blanket `unsupported` — which would fire on every export ever made, including the ones that are not broken. See D25's corollary in `product-decisions.md`.

**[N1]** `responsiveImageMode` on Illustrator is `no`, not `DEAD`: absent from `buildCanonicalIrSettings` and from the panel key map, so nothing can set it. The core falls back to the default `"img-src"`.

---

## Table B — Features × Surface

| Feature | IL | AE | FIG | CLI/SVG |
|---|---|---|---|---|
| Format `html` | yes (**only** format; hardcoded `src/extendscript/index.ts#emitHTMLString`) | no¹⁰ | yes | yes |
| Format `standalone` | no (emitter exists, unreachable) | no | yes | yes |
| Format `svelte` | no | no | no (gated `figma/src/messages.ts#isUiToSandboxMessage`) | yes |
| Format `react` | no | no | no (same gate) | yes |
| Tag `:svg` | yes | no | yes | yes (render) / no (import) |
| Tag inline SVG | yes — `:svg,inline` **or** `:inline` | no | yes — `:svg:inline` **only** | yes (render) / no (import) |
| Tag `:png` | yes | no | yes | yes (render) / no (import) |
| Tag `:symbol` | yes | no | no — recognized only to warn¹³ | yes (render) / no (import) |
| Tag `:div` | yes¹¹ | no | no — same¹³ | yes (render) / no (import) |
| Tag `:video` | yes | no | yes | yes (render) / no (import) |
| Tag `:html-before` / `:html-after` | yes | no | yes | yes (render) / no (import) |
| Responsive grouping | yes | no | yes | yes |
| `output: multiple-files` | yes (html) [D10 fixed] | no | yes (html + standalone) | yes (all four formats) |
| 2x / retina raster | yes | no | **DEAD at default** [D9] | yes (import) / n/a (render) |
| Text effects (shadow / blur) | no¹² | no | no | yes if in IR — **no producer** |
| Hyperlinks on text runs | yes | no | yes (URL only; node-level links dropped with warning) | yes |
| Custom blocks (css/js/html) | yes — `all2html-` and `ai2html-` both match; `all2html-` wins key-by-key on settings/text | no | yes, **Advanced JSONC only**, no UI control | yes if in IR / no on SVG import |
| Promo image | yes | no | **DEAD** [D24] | **DEAD** [D25] |
| Lazy loading | images + video yes [D31 fixed] | no | images + video yes | images + video yes |

10. AE writes HTML, but through no core emitter: `after-effects/exporter.jsx#buildHtml` splices literal tokens into its own `player-template.html`. It emits a bespoke `stage/media/layers` model, **not** `ir.json`. `grep -c All2Html` = 0.
11. Code path exists but no tracked fixture contains a `:div` layer — code-verified only.
12. No exporter or importer ever populates `TextElement.effects`.
13. Not DEAD: `UNSUPPORTED_TOKENS` in `extract/layers.ts:33` recognizes the tag solely in order to report it (`unsupportedLayerTokenWarning`, `runtime-extract.ts:70`). The tag is ignored and the layer exports as ordinary artwork, so the user is told what happened instead of the parser claiming a layer type the runtime refuses three files later.

### Tag syntax divergence (exact)

- **Illustrator** (`extractLayers` in `plugins/illustrator/exporter.jsx`) — splits on the **first `:`**, lowercases the remainder, exact match, no trimming. Accepts `:svg`, `:svg,inline`, `:inline`, `:png`, `:symbol`, `:div`, `:video`, `:html-before`, `:html-after`. Artboard-name tokens are a *separate* syntax (`name:tok1,tok2`, `key=value`, bare integer).
- **Figma** (`extract/layers.ts:14-46`) — case-insensitive, matched as **prefix or suffix**, first match wins. Accepts `:svg:inline` but **not** `:svg,inline` or `:inline`. Only direct children of the selected frame are scanned. Frame tokens: `:dynamic`, `:fixed`, `:image-only` (documented) and `:image` (accepted for compatibility), bare integer = width override. `:symbol` and `:div` are recognized only to warn — the layer exports as ordinary artwork.
- **SVG importer** (`import-core.ts:137-177`) — filename-stem suffixes only: `:dynamic`/`--dynamic`, `:image`/`--image`, `:<int>`/`--<int>`. **No layer tags at all**; every layer is `type:"default"`.

---

## Honored by the core, triggerable by no surface

These are unwired features, not dead code. Per decision D16, each needs either a test pinning its intended caller or a deletion that names its replacement.

1. **Text effects → `g-effect{N}` classes.** Fully implemented (`deduplicate-styles.ts#effectsToCSS`, applied at `shared/css.ts#effectStyleClasses`). **Zero producers** — `TextElement.effects` is never set by any exporter or importer. The only IR carrying it is a hand-written fixture.
2. ~~**`src/core/svg-postprocess.ts`** entire.~~ **Resolved by deletion (D16).** Zero importers repo-wide; its `options.idPrefix` was the only implementation that would have satisfied `svgIdPrefix` (D19–D21). Deleted with its test rather than wired: nothing on any surface asked for it, and the `unsupported` declarations are what stop the setting from silently no-opping. Re-implementing means writing prefixing into the emitter that mints the ids and flipping the four declarations in the same change.
3. **SnippetElement rendering.** Emitters render `data-replaceable` nodes, but no surface emits an element of that type. (Consistent with the v1.1 deferral.)
4. **The `emit` config block** — `fitMode`, `positionMode: "percentage"`, `allowUnsafeHtml: false`, React `typescript`. **Figma reaches it now**: `figma/src/config.ts#EmitterConfigSchema` parses `emit` with the canonical schema — the same one the CLI reads, not a plugin-local shape — and `export.ts` forwards it as the third argument to `emitAll`. **Illustrator still does not**: `src/extendscript/index.ts#emitHTMLString` is called as `emitHTMLString(ready, { artboards, slug })` with no emitter options, so the block is unreachable from the production surface.
5. **`emitHTML` vs `emitHTMLString` reachability.** Illustrator is the sole consumer of the string emitter; CLI, browser, and Figma all use the hast emitter. Any capability added only to the registry path is structurally unreachable from Illustrator.

---

## Caveats

- No live-tool verification (Illustrator/AE/Figma were not launched). Cells marked `yes` that are honored *inside the core* are proven by code trace plus tracked `data/all2html-output/*/ir.json` artifacts. The four highest-stakes claims — `imageFormat:svg`, `output:multiple-files`, `htmlOutputPath` on CLI, `htmlOutputExtension` on CLI — were each verified against a real artifact or a real CLI run.
- **`data/all2html-output/multiple-files-test/` was re-exported from live Illustrator on this branch and holds the two per-artboard `.html` files** — the saved output and the D10 fix now agree, and `test/integration/surface-entrypoints.test.ts` pins the behavior against the shipped bundle regardless.
- **Duplicate widths inside one responsive group are now a hard error on every surface**, thrown by `computeBreakpoints` rather than by one exporter. Figma already rejected them at extraction; Illustrator, the CLI and SVG import previously assigned ranges by array order, which is arbitrary. The most likely real encounter is multi-file SVG import in `one-file` mode with two same-width files. The same width in two *different* groups remains legal.
- `:div` on Illustrator and the `ai2html-js` custom block are code-verified only; no tracked fixture exercises them.
- Several tracked `ir.json` files carry raw snake_case settings (`countries`, `fixed`, `template`, `text-cleanup`, `sample-ai-file`) that predate the camelCase rule and are silently ignored by `resolveSettingsPure`. Not used as evidence for any cell.
