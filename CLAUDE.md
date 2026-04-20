# all2html

Clean-room reimplementation of ai2html as a plugin-based system. Exporters produce the canonical IR (JSON + images), and the TypeScript core renders it to HTML/Svelte/React. Illustrator is the production exporter in this phase; the Figma plugin now has a runnable newsroom-facing beta UI, but it is not yet a user-facing supported exporter.

## Commands

- `pnpm test` — run unit + integration tests (vitest)
- `pnpm check:illustrator-fixtures` — audit the real Illustrator fixture registry against tracked artifacts
- `pnpm test:visual` — run Playwright visual regression tests
- `pnpm run typecheck` — type check without emitting
- `pnpm build:extendscript` — build ES5 core bundle
- `pnpm build:figma` — build the runnable Figma plugin to `plugins/figma/dist/`
- `pnpm build:illustrator` — build assembled Illustrator plugin (~136KB)
- `pnpm build:panel` — build Illustrator panel package from source
- `pnpm package:panel` — build Illustrator bundle + signed panel package
- `pnpm package:panel:zip` — build Illustrator bundle + panel zip
- `pnpm diagnostics:illustrator` — read structured CEP diagnostics from the Illustrator host
- `pnpm diagnostics:after-effects` — read structured CEP diagnostics from the After Effects host
- `pnpm exec tsx src/cli/index.ts render <ir.json> -o <dir> [--format html|standalone|svelte|react] [--verbose]`
- `pnpm exec tsx src/cli/index.ts watch <ir.json> -o <dir> [--format html|standalone|svelte|react] [--verbose]` — watch mode
- `pnpm exec tsx src/cli/index.ts validate <ir.json>` — validate IR schema
- `bash scripts/test-illustrator.sh` — run all .ai files through Illustrator (needs AI running)
- `pnpm exec tsx scripts/generate-illustrator-hardening-fixtures.ts [fixture...]` — regenerate the scripted real Illustrator `.ai` fixtures (pass names to avoid rewriting unrelated binaries)
- `pnpm exec tsx scripts/export-illustrator-fixtures.ts --golden [fixture...]` — re-export tracked Illustrator fixtures through the real bundle and refresh saved outputs/goldens
- `pnpm test -- figma-plugin figma-runtime figma-ui-model figma-fixtures figma-pipeline` — focused coverage for the Figma plugin beta surface and hardening corpus

## Architecture

**Pipeline:** IR JSON → `loadAndValidateIR` → `resolveSettings` → `computeBreakpoints` → `computeStyles` → `deduplicateStyles` → `computePositions` → `groupArtboards` → emitter

Each transform takes a phase-typed document and returns the next phase:
`Document` → `ResolvedDocument` → `StyledDocument` → `DeduplicatedDocument` → `EmitterReadyDocument`

**Boundary rule:** Input plugins (e.g. ExtendScript) extract data the design tool knows. The core handles everything tool-agnostic (CSS, positions, breakpoints, HTML).

**Figma rule:** `plugins/figma/` must target the canonical IR directly. Selected top-level frames are the only v1 export roots. Same-base-name frames form responsive groups; duplicate widths in one group are a hard error.

**Bundling:** The core compiles to an ES5 IIFE that runs inside Illustrator's ExtendScript runtime. The assembled `dist/all2html.js` is one self-contained file (json2 polyfill + ES5 polyfills + core bundle + exporter). No Node.js required.

## Key Conventions

- IR documents must include `irVersion` (currently `"0.0.0"` pre-release)
- All positions in IR are absolute pixels, top-left origin, per-artboard coordinate space
- IR `letterSpacing` is in em units (CSS-ready). Exporters convert from tool-native (e.g., AI tracking / 1000)
- IR `opacity` fields are 0-100 scale (Illustrator convention). Core converts to CSS 0-1
- Asset record keys must equal `asset.id`. Paths are relative to IR file directory
- `metadata` accepts arbitrary extra keys (JSON-serializable values). The core pipeline must never read or branch on non-typed metadata keys — they are passthrough for emitters/consumers only.
- Plugins must target the canonical IR types/schemas in `src/ir/`. Do not define shadow IR contracts inside plugin directories.
- Figma plugin config is JSONC stored as document-local plugin data. Keep it thin: canonical `settings`, `metadata`, `fonts`, and `customBlocks` only.
- Figma plugin persistence: shared config lives in `figma.root` plugin data; local convenience state (currently output format, preset, and disclosure state) lives in `figma.clientStorage`.
- Figma plugin delivery is ZIP-first: export `ir.json`, emitted HTML/standalone files, and any extracted asset bytes together. Do not add a Figma-only render path.
- Figma plugin runtime: export only selected top-level frames, clone them into a temporary export tree, detach nested instances, disable auto layout, hide extracted text before background raster export, and clean up temp nodes on all paths.
- Figma plugin UX rule: direct controls are primary, Advanced JSONC is secondary, and both must edit the same canonical config object.
- Figma plugin support rule: do not claim Figma support until the hardening corpus, repeated live exports, and typical-newsroom-file UX bar are actually met.
- Dedicated live Figma hardening file: `all2html figma support fixtures` at `https://www.figma.com/design/9CCiLrpJrr5IdXCGQSObDB`, page `support-fixtures`
- Figma support bar is tracked in `internal-docs/figma-support-gate.md`; keep repo fixtures and the live support file aligned before changing support claims.
- Illustrator/exporter rule: normalize tool-native snake_case settings to canonical camelCase IR settings before building `irDoc`. Accessibility fields such as `altText` / `ariaRole` belong in `metadata`, not `settings`.
- Illustrator/exporter rule: invalid `:video` layers and empty/invalid html-hook blocks/layers must warn explicitly through the existing grouped warning system. Do not silently ignore them in new exporter work.
- CSS values rounded to 4 decimal places
- Style class assignment is deterministic: sorted by descending frequency then alphabetical key
- Text effects (drop shadow, blur) are deduplicated into `g-effect{N}` classes like pstyle/cstyle
- Hyperlinks on text runs emit as `<a>` tags wrapping the run content
- Always include all CSS properties in computed styles (don't omit `text-align: left` — the page may have different defaults)
- No `as any` in core transforms — use the phase types (`EmitterReadyShapeElement`, etc.)
- Document model must stay JSON-serializable (no `Map`, no `Set`)
- Generated artifacts (`dist/`, panel `dist/`, `.zip`, `.zxp`) are release outputs, not tracked source files
- Attribute values in HTML output must use `escapeAttr()`
- Config files use JSONC (parsed with `jsonc-parser` in Node, `//` stripping in ExtendScript)
- HTML emitter (hast) and HTML string emitter must produce byte-identical output — test with `html-string-emitter.test.ts` and fixture coverage
- After rebuilding core, must also `pnpm build:extendscript` before bundle tests pass
- Use the `ObservableLogger` interface for pipeline observability — pass via `options.logger` to `processDocument()`. Default is `noopLogger` (zero overhead). Use `createConsoleLogger()` for CLI verbose mode, `createCollectingLogger()` for tests.
- In hast emitter: do NOT call `escapeAttr()`/`escapeHtml()` on values passed to `h()` — hast auto-escapes. Only escape inside `raw()` nodes.
- Emitter registry (`src/emitters/registry.ts`): all emitters return `{ files: EmitFile[], warnings }` via `emitAll(doc, groups)`. CLI uses `getEmitter(format)` — no if/else dispatch.
- `allowUnsafeHtml` emitter option: when `false`, suppresses `binding.allowHtml` on tagged text. Defaults to `true` (ai2html parity).
- `positionMode` emitter option: `"percentage"` converts remaining absolute text widths/anchor margins to percentage-based CSS transforms at emit time. Defaults to `"absolute"`.
- Real Illustrator hardening fixtures are tracked in `test/fixtures/illustrator-fixtures.ts`. Keep the registry, `data/all2html-output/<fixture>/`, `test/fixtures/golden-ir/<fixture>.json`, and visual baselines aligned.
- The real Illustrator export harness writes `summary.json` alongside saved fixture outputs when automated exports surface warnings/results needed by tests. Keep it aligned with the saved output refresh flow.

## CEP Panel

The Illustrator CEP panel lives at `plugins/illustrator/panel/` (workspace package `@all2html/panel`). Stack: Bolt CEP pattern + Svelte 5 + Vite + vite-cep-plugin.

Shared CEP architecture is documented in `internal-docs/cep-panel-architecture.md`.

**Commands:**
- `pnpm build:panel` — production build to `plugins/illustrator/panel/dist/cep/`
- `pnpm dev:panel` — dev mode with HMR
- `pnpm package:panel` — build + sign as .zxp
- `pnpm diagnostics:illustrator` / `pnpm diagnostics:after-effects` — read structured host diagnostics from the shell
- Panel builds read `dist/all2html.js` and emit `jsx/all2html.js` into the packaged panel output

**Shared structure:**
- `bridge.ts` / `ae-bridge.ts` are host-specific entry points
- `bridge-shared.ts` holds shared CEP bridge behavior such as diagnostics access and folder opening
- `document-watcher.ts` / `ae-document-watcher.ts` share `polling-watcher.ts`
- `persistence.ts` / `ae-persistence.ts` share `default-storage.ts`
- `panel-controller.ts`, `PanelShell.svelte`, and `RunResult.svelte` are shared shell/runtime layers
- `hostscript.ts` is the ExtendScript command surface, backed by `export-runner.ts` and `diagnostics.ts`

**Validation loop for CEP changes:**
- run targeted `vitest`
- run `pnpm exec tsc --noEmit`
- run `pnpm build:panel`
- then do live Illustrator and/or After Effects smoke if the change touches hostscript, panel mounting, document/project detection, export, diagnostics, or folder opening

**Debugging the CEP panel:**
- CEP log files: `~/Library/Logs/CSXS/CEPHtmlEngine12-ILST-*.log` — check here first for JS errors
- Debug port: `localhost:8870` (Chrome DevTools protocol). Use `curl -s http://localhost:8870/json` to check if alive
- Force reload without restarting Illustrator: connect via WebSocket and send `Page.reload`:
  ```python
  import json, asyncio, websockets, urllib.request
  async def reload():
      pages = json.loads(urllib.request.urlopen("http://localhost:8870/json").read())
      ws_url = [p["webSocketDebuggerUrl"] for p in pages if "all2html" in p.get("title","")][0]
      async with websockets.connect(ws_url) as ws:
          await ws.send(json.dumps({"id":1,"method":"Page.reload","params":{"ignoreCache":True}}))
          print(await asyncio.wait_for(ws.recv(), timeout=3))
  asyncio.run(reload())
  ```
- Evaluate JS in the panel remotely: same WebSocket, use `Runtime.evaluate`
- Toggle panel visibility: AppleScript `click menu item "all2html" of menu "Extensions" of menu item "Extensions" of menu "Window" of menu bar 1`
- CEP debug mode must be enabled: `defaults write com.adobe.CSXS.12 PlayerDebugMode 1`
- Symlink auto-created by vite-cep-plugin at `~/Library/Application Support/Adobe/CEP/extensions/com.all2html.panel`

**Key gotchas:**
- ExtendScript has no built-in `JSON` — the hostscript must bundle json2.js polyfill (via rollup banner in `vite.es.config.ts`)
- CSInterface.js (Adobe library) must load before the main bundle — it's in `public/CSInterface.js`, copied to dist as a static asset
- CEP caches the panel HTML aggressively — toggling the panel off/on does NOT reload. Must force-reload via debug protocol or restart Illustrator
- Panel settings injected into exporter via temp file (`$.global.__ALL2HTML_PANEL_SETTINGS_PATH__`), not evalScript payload (avoids size limits)
- AE panel settings are injected inline through `$.global.__ALL2HTML_AE_PANEL_SETTINGS__`
- Panel settings resolution is per-field, not single-source: `text-block > document XMP > config file > app defaults > core defaults`
- Field badges mean: `doc` = locked by `ai2html-settings`, `edit` = changed in the panel relative to inherited resolved settings, `xmp` = loaded from document XMP, `cfg` = loaded from `all2html.config.json`, `def` = loaded from saved panel defaults
- Badge precedence is `doc > edit > inherited source`. Pure core-default fields stay unbadged to avoid noise.
- Panel diagnostics are first-class. Check the in-panel diagnostics surface first, then `pnpm diagnostics:illustrator` or `pnpm diagnostics:after-effects` before falling back to screenshots.
- `Open folder` is panel/Node-first and host fallback second. After Effects host fallback must never be the first debugging target for folder-opening failures.

## Deferred Features (v1.1+)

These are specced but NOT implemented yet. Don't implement without checking SPEC.md phasing:
- SnippetElement rendering (v1.1)
- Tagged text bindings (v1.2)
- onMounted/onArtboardChange callbacks (v1.2)
- CSS custom property image loading (v1.1)
- Global config file (`~/.all2html/config.json`) (v2)

## Reference

- `SPEC.md` — full technical specification
- `PROGRESS.md` — what's done, what's deferred, known limitations
- `research/ai2html-feature-spec.md` — exhaustive ai2html feature catalog (1348 lines)
- `research/ai2svelte-feature-spec.md` — Reuters ai2svelte analysis (CEP extension, snippets, tagged text)
