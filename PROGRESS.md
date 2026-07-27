# Progress

## Current Stats
- **77 vitest test files** covering the pipeline, all five emitters, both plugin
  hosts and the CEP panel
  <!-- Deliberately not a test *count*. A count rewards multiplication: the suite
  had grown to 1670 tests of which ~700 were fixture × option matrices reporting
  a single bug dozens of times over ("does the JSX parse", asserted 256 times).
  Breadth is measured by what is covered, not by how many `it`s a nested loop
  emits. If you want the number it is ~1000; do not optimize it upward. -->
- **52 IR corpora under continuous sweep**: every hand-written fixture compiles
  under both framework emitters, and every golden validates + round-trips
- **~190KB** assembled Illustrator plugin (`dist/all2html.js`) — the tracked
  baseline is `assembled.bytes` in `test/fixtures/extendscript-bundle-baseline.json`
  (currently 194,181 B)
- **32 IR test fixtures** + **20 golden IR fixtures** from real Illustrator exports
- **20 tracked real Illustrator source fixtures** in `data/`
- **5 output formats**: HTML fragment, Standalone HTML, Svelte, React, ExtendScript bundle

## Completed

### Core Pipeline
- [x] IR schema with **exclusive** phase types (SPEC §12.1 / D20): `Document → Resolved → Breakpointed → Styled → Deduplicated → EmitterReady`, each carrying a `pipelinePhase` literal so no transform can be skipped or repeated without a compile error. Image-rendered text is its own variant (`ImageTextElement`); `EmitterReadyLayer` admits no un-positioned variants. Removed the placeholder breakpoint in `settings-resolver.ts`, the placeholder `computedPosition` in `deduplicate-styles.ts`, and 12 runtime property-sniffing guards across the transforms and emitters.
- [ ] `Artboard.relationship: "alternates" | "sequence"` (SPEC §12.10.5) is **not** in the IR. It was declared and validated with no consumer, and was removed under D27 rather than documented as unused; it lands with `groupArtboards`, which is where it has to act and which is blocked on ES3 safety (D19).
- [x] Zod validation, default settings, JSONC config
- [x] CSS-identifier sanitizing on the Zod-free path: `src/extendscript/index.ts` checks `namespace`, `projectName` and `svgIdPrefix` against `SAFE_SETTING_IDENTIFIER_RE` (defined in `src/ir/settings-definitions.ts`, re-exported from `schema.ts` so there is one pattern, not two). A rejected value falls back to its declared default and warns `setting:invalid-value` rather than aborting the export — every Zod-free caller enters through this bundle, so the check belongs there rather than in one exporter
- [x] resolveSettings + resolveSettingsPure (fs-free for ExtendScript)
- [x] computeBreakpoints, computeStyles, fontMap, deduplicateStyles, computePositions
- [x] groupArtboards (one-file / multiple-files output)
- [ ] SVG post-processing (ID cleanup, `data-name`, hex decode, opacity/multiply, non-scaling-stroke, raster removal) — `src/core/svg-postprocess.ts` implemented all of this and was imported by nothing but its own test on any surface. Deleted under D16; nothing replaces it, and `svgIdPrefix` stays declared `unsupported` in `src/core/capabilities.ts` so the setting warns rather than silently no-opping
- [x] Template system (Mustache + EJS), warning consolidation, asset path tokens
- [x] Text effects: drop shadow → `text-shadow`, blur → `filter: blur()`, deduplicated as `g-effect{N}` classes
- [x] Hyperlinks on text runs: `CharacterRun.hyperlink` → `<a>` tags in both emitters

### Observability
- [x] Pluggable `ObservableLogger` interface (debug/info/warn/error/startSpan)
- [x] `createConsoleLogger()` — structured output with timing
- [x] `createCollectingLogger()` — captures events for programmatic use
- [x] `noopLogger` — zero overhead default
- [x] CLI `--verbose` flag
- [x] ExtendScript exporter: `logSpan()` with `$.writeln()` timestamps

### Emitters (5 formats)
- [x] HTML — one emitter: a node-tree builder (`emitters/html-tree.ts`) over an ES3-safe serializer (`emitters/shared/html-node.ts`). `html.ts` and `html-string.ts` are re-export entry points, not two implementations. Covers text, shapes, video, SVG/PNG layers, raw HTML
- [x] Standalone HTML with template support
- [x] Svelte component ($props, assetsPath, scoped CSS)
- [x] React component (typed props, assetsPath, className)
- [x] Container queries with aspect-ratio + padding shim, style dedup, accessibility, custom blocks
- [x] Emitter registry with `files[]` return type — uniform group handling, no CLI if/else dispatch
- [x] `allowUnsafeHtml` emitter gate — suppresses `binding.allowHtml` when disabled
- [x] `positionMode: "percentage"` emitter option — converts remaining absolute text widths/anchor margins at emit time

### ExtendScript Exporter
- [x] Document validation, settings parsing, custom code blocks
- [x] Artboard enumeration with name annotations
- [x] Layer structure with all type detection
- [x] Text frame extraction with character run scanning
- [x] SVG layer export (temp document, inline option)
- [x] PNG layer export (transparent, isolated)
- [x] Symbol/div shape detection (rectangles, circles, lines)
- [x] Video layer URL extraction
- [x] HTML before/after layer content extraction
- [x] Locked object handling (LIFO unlock/relock restore stack)
- [ ] Clipping mask detection — the `findClippedTextFrames` helper had no call sites and was deleted rather than wired (it excluded every text frame in a clipping group, not just the clipped ones). Masked text still exports; see Known Limitations
- [x] Image export (PNG8/JPG, auto format, retina 2x)
- [x] Local config file resolution, cache bust auto-increment, promo image
- [x] Overset text detection, automated mode, timing + structured warnings
- [x] Invalid `:video` layers warn explicitly and do not emit broken `<video>` markup
- [x] Hidden/empty html hook blocks and layers warn explicitly instead of failing silently
- [x] Block/layer names accept `all2html-` (primary) and `ai2html-` (compat alias) at every match site. When a document carries both settings/text blocks, `all2html-` wins key-by-key, order-independent; uncontested legacy keys are kept. Pinned by `test/unit/illustrator-block-prefixes.test.ts`, which derives the matchers from the shipped `.jsx`

### Illustrator Hardening + Fixtures
- [x] Tracked Illustrator fixture registry with required artifact metadata
- [x] `pnpm check:illustrator-fixtures` audit for source files, saved output, golden IR, visual baselines, and checklist coverage
- [x] Saved real-output corpus tracked under `data/all2html-output/`
- [x] Automated `summary.json` capture for warning/result assertions from real Illustrator exports
- [x] Release-blocking real fixtures: `multiple-files-test`, `layer-types-test`, `mask-test`, `settings-precedence`, `layer-export-matrix`
- [x] Editorial hardening fixtures: `video-editorial`, `html-hooks-editorial`, `large-story`
- [x] Focused real fixtures for hyperlinks, accessibility, rotated text, character styles, font mapping, and overset text
- [x] Targeted scripted fixture generation (`scripts/generate-illustrator-hardening-fixtures.ts [fixture...]`) to avoid rewriting unrelated `.ai` binaries

### Figma Plugin Beta
- [x] Canonical Figma plugin foundation under `plugins/figma/` — no shadow IR contracts
- [x] Strict selection contract: selected top-level frames only
- [x] Responsive grouping contract: same base name groups, duplicate widths fail clearly
- [x] Canonical text-run mapping from Figma-style segments (`letterSpacing` in em, hyperlinks preserved)
- [x] Canonical Figma config parsing (JSONC → `settings` / `metadata` / `fonts` / `customBlocks`)
- [x] Pipeline-backed export bundling: Figma IR → `processDocument()` → existing emitters → ZIP archive
- [x] Figma-focused unit + integration coverage for canonical build and HTML emission
- [x] Runnable Figma plugin build (`pnpm build:figma`) producing `dist/main.js` + `dist/ui.html`
- [x] Figma sandbox/UI message contract for selection summary, config load/save, local UI persistence, warnings, and ZIP export
- [x] Real Figma runtime extraction path: selected frame cloning, instance detaching, auto-layout disabling, text overlay extraction, background PNG export
- [x] Beta Figma UI with a minimal export/content surface, newsroom presets, collapsed advanced settings, and Advanced JSONC for power users
- [x] Extracted-frame fixture corpus for Figma-shaped single-frame, responsive-group, hyperlink, image-only, nested-frame, and unsupported-warning cases
- [x] Actionable Figma warning/export summaries surfaced in the plugin UI instead of status-count only
- [x] Dedicated live Figma support fixture file with realistic newsroom cases mirrored into repo-side regression fixtures
- [x] HTML + Standalone HTML newsroom regression checks for single, responsive, nested, and mixed-warning Figma story fixtures
- [x] Illustrator-aligned Figma special-layer extraction for top-level `:png`, `:svg`, `:svg:inline`, `:video`, `:html-before`, and `:html-after` nodes
- [x] Special-layer newsroom fixtures and live `support-special-layers` page covering overlays, hooks, video, and mixed responsive exports
- [x] Internal Figma support gate doc tracking what passes now vs what still blocks a support claim

### IR Schema Improvements
- [x] `irVersion` field on Document (pre-release: `"0.1.0"`)
- [x] `letterSpacing` in em (was `tracking` in AI thousandths) — exporters convert at boundary
- [x] `renderAsReason` on TextElement — explains why exporter chose html/image
- [x] `direction` on Paragraph (optional: `"ltr" | "rtl"`)
- [x] `lang` on Metadata (optional: BCP 47 tag)
- [x] Arbitrary passthrough metadata via index signature (`.catchall(JsonValue)` in Zod)
- [x] `Paragraph.text` validated against `runs[].text` concatenation
- [x] `Asset.exportParams.format` validated as enum
- [x] Asset record key must equal `asset.id`
- [x] Unit convention JSDoc comments on opacity, letterSpacing, Color.opacity

### Testing
- [x] 77 vitest test files
- [x] 32 IR fixtures + 20 golden IR fixtures from real Illustrator exports
- [x] Hardening-specific integration coverage for real Illustrator fixtures — every
      registered fixture is either asserted by name or on an explicit exemption list,
      checked by a registry test (no early-`return` tests that pass while asserting nothing)
- [x] Fixture coverage (one end-to-end check per fixture), specific feature tests, golden IR tests
- [x] Serializer↔hast byte-equality (`test/unit/html-serializer.test.ts`), bundle regression, multiple-files output tests
- [x] Both framework emitters sweep the **whole** fixture corpus under default options
      (the shared list in `test/fixtures/component-fixtures.ts`); emitter *options* are
      swept only over structurally distinct fixtures, since a second fixture of the same
      shape cannot fail where the first passes
- [x] Adversarial escaping matrix (`test/unit/emitter-escaping-parity.test.ts`) keeps its
      full option cross-product — that axis genuinely changes behavior and caught a
      four-field divergence that only appeared under specific combinations
- [x] Playwright visual baselines for layout-sensitive real Illustrator fixtures

### Documentation
- [x] README.md with config reference, troubleshooting, architecture
- [x] plugins/illustrator/README.md
- [x] CLAUDE.md files (root + core + emitters + ir)
- [x] Illustrator hardening matrix + manual QA checklist

## Deferred to v2+

| Feature | Version | Notes |
|---|---|---|
| SnippetElement rendering | v1.1 | IR schema ready |
| Tagged text bindings | v1.2 | Binding paths, text overrides |
| Lifecycle callbacks (onMounted, onArtboardChange) | v1.2 | Svelte/React |
| CSS custom property images | v1.1 | --bg-image pattern |
| Global config (~/.all2html/config.json) | v2 | Only local supported |
| TypeScript React output (.tsx) | v1.1 | `emitterConfig.react.typescript` — already implemented |
| Settings block creation | v2 | Create if missing |

## Confirmed Broken

Verified against the code and reproduced. These are defects, not limitations — several are features listed as complete above.

| What | Where | Effect |
|---|---|---|
| `output: multiple-files` no-op on Illustrator | `src/extendscript/index.ts:172` (`processAndEmit`) | `groupArtboards` never called; the `multiple-files-test` fixture emits one file |
| `imageFormat: svg`/`png24` → PNG8 on Illustrator | `exporter.jsx:1178-1194` (`exportArtboardImage`) | Silently wrong format, no warning |
| Illustrator emits HTML only | `src/extendscript/index.ts:172` (`processAndEmit`) | Standalone/Svelte/React unreachable from the production surface |
| Element ids not slug-prefixed | minted in `plugins/illustrator/exporter.jsx:712`, emitted un-namespaced by `src/emitters/html-tree.ts:170` | Two graphics on one page collide on `g-ai0-1`. Both files are involved: the exporter mints the id, the emitter passes `element.id` through without a slug prefix |
| Visual baselines are stale | `test/visual/fixture-output/` | 28 checked-in HTML files nothing regenerates; ~56 tests screenshot a superseded emitter |
| `useLazyLoader` emits `data-src` with no loader | `html-tree.ts` (`video` layer arm) | **No loader script is emitted anywhere in `src/`** — lazy videos never receive a `src` and simply never play. The emitter warns per video layer (`video:lazy-src-no-loader`); the loader is still unimplemented |
| `output: multiple-files` collapses for `standalone` | `registry-shared.ts:84-96` | `emitAll` discards `groups`; verified html→2 files, svelte→2, react→2, **standalone→1** |
| Figma `:symbol` and `:div` parsed then rejected | `runtime-extract.ts:464` | Recognized by the tag parser, then skipped with a warning |
| Figma frame token is `:image`, not `:image-only` | `extract/frames.ts:33` | Diverges from the Illustrator artboard-token vocabulary |

**31 DEAD settings cells** (a control accepts a value, the export succeeds, nothing happens) are catalogued with file:line proof in [`internal-docs/capability-matrix.md`](internal-docs/capability-matrix.md). That document is the evidence base for the capability-declaration work in SPEC §12.5. D1-D30 warn from the core capability check on Illustrator, Figma, the CLI and the browser; D31 warns from the emitters. After Effects declares its capabilities but does not enforce them — it never loads the core (decision D26).

`htmlOutputExtension` is the newest entry in that table: Illustrator honors it, but the CLI, browser and Figma declare it `partial` with `unsupportedFormats: ["standalone", "svelte", "react"]`, since svelte/react force `.svelte` and `.jsx`/`.tsx` and standalone always writes `.html`. Requesting it under those formats now warns instead of being silently dropped.

## Known Limitations

- Windows CEP/manual Illustrator QA still requires a real Windows Illustrator environment
- macOS 2019 floor validation remains a manual lane, not CI
- Figma plugin now has a realistic newsroom support corpus, but it still lacks repeated live export QA and should remain beta/internal
- Figma special layers now cover the main Illustrator-aligned tags, but `:symbol` and `:div` remain deferred on the Figma side
- Figma plugin still has no repeated live visual baseline capture from real Figma exports
- ExtendScript now uses a deterministic `tsc -> rollup` build path to avoid stale-bundle drift; revisit later if we want a cleaner single-step build without reintroducing resolution/transpilation mismatches
- Illustrator: text hidden by a clipping mask still appears in the output. The exporter filters text frames by artboard intersection, visibility, and layer tag, never by mask geometry — `plugins/illustrator/exporter.jsx` carried a `findClippedTextFrames` helper for this that was never called, and it was deleted rather than wired because it excluded every text frame in a clipping group whether or not it was actually clipped. Workaround: delete or move clipped text instead of relying on the mask to hide it
- Rotated text transform-origin may drift vs ai2html on edge cases
- Illustrator export cost is dominated by asset writing, not by scanning. Measured
  2026-07-27: `layer-types-test.ai` 0.2s, `countries.ai` 4.0s (3.4s of it writing two
  210 KB inline SVGs). Character scanning is 17 ms for 258 characters and the text-frame
  filter is 4 ms for 72 frames, so neither is worth optimizing. The former note here
  ("character scanning is slow on large documents") was wrong and cost a day chasing it
- Missing fonts: substituted with defaults
- Document marked as modified after export (due to unlock/relock)
