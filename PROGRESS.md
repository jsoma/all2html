# Progress

## Current Stats
- **595 vitest tests** across 33 test files
- **145KB** assembled Illustrator plugin (`dist/all2html.js`)
- **31 IR test fixtures** + **20 golden IR fixtures** from real Illustrator exports
- **20 tracked real Illustrator source fixtures** in `data/`
- **5 output formats**: HTML fragment, Standalone HTML, Svelte, React, ExtendScript bundle

## Completed

### Core Pipeline
- [x] IR schema with phase types (Document → Resolved → Styled → Deduplicated → EmitterReady)
- [x] Zod validation, default settings, JSONC config
- [x] resolveSettings + resolveSettingsPure (fs-free for ExtendScript)
- [x] computeBreakpoints, computeStyles, fontMap, deduplicateStyles, computePositions
- [x] groupArtboards (one-file / multiple-files output)
- [x] SVG post-processing (ID cleanup, data-name, hex decode, opacity/multiply, non-scaling-stroke, raster removal)
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
- [x] HTML fragment (hast) — all element types: text, shapes, video, SVG/PNG layers, raw HTML
- [x] HTML string (byte-identical, no deps) — for ExtendScript bundle
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
- [x] Clipping mask detection, locked object handling
- [x] Image export (PNG8/JPG, auto format, retina 2x)
- [x] Local config file resolution, cache bust auto-increment, promo image
- [x] Overset text detection, automated mode, timing + structured warnings
- [x] Invalid `:video` layers warn explicitly and do not emit broken `<video>` markup
- [x] Hidden/empty html hook blocks and layers warn explicitly instead of failing silently

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
- [x] `irVersion` field on Document (pre-release: `"0.0.0"`)
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
- [x] 32 vitest test files, 586 tests
- [x] 31 IR fixtures + 20 golden IR fixtures from real Illustrator exports
- [x] Hardening-specific integration coverage for real Illustrator fixtures
- [x] Fixture coverage (every fixture × 4 checks), specific feature tests, golden IR tests
- [x] String emitter parity, bundle regression, multiple-files output tests
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

## Known Limitations

- Windows CEP/manual Illustrator QA still requires a real Windows Illustrator environment
- macOS 2019 floor validation remains a manual lane, not CI
- Figma plugin now has a realistic newsroom support corpus, but it still lacks repeated live export QA and should remain beta/internal
- Figma special layers now cover the main Illustrator-aligned tags, but `:symbol` and `:div` remain deferred on the Figma side
- Figma plugin still has no repeated live visual baseline capture from real Figma exports
- ExtendScript now uses a deterministic `tsc -> rollup` build path to avoid stale-bundle drift; revisit later if we want a cleaner single-step build without reintroducing resolution/transpilation mismatches
- Rotated text transform-origin may drift vs ai2html on edge cases
- ExtendScript character scanning is slow on large documents
- Missing fonts: substituted with defaults
- Document marked as modified after export (due to unlock/relock)
