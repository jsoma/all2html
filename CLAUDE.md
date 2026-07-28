# all2html

Clean-room reimplementation of ai2html as a plugin-based system. Exporters produce the canonical IR (JSON + images), and the TypeScript core renders it to HTML/Svelte/React. Illustrator is the production exporter in this phase; the Figma plugin now has a runnable newsroom-facing beta UI, but it is not yet a user-facing supported exporter.

## Commands

Requires **Node 20.19+, 22.12+, or 23+** (declared in `package.json` `engines`; enforced at install by `.npmrc` `engine-strict` and at test time by `scripts/check-node-version.mjs`). jsdom's dependency chain needs `require(esm)`; on excluded Nodes (including all of 21.x) two test suites fail at collect time rather than failing an assertion, so the failure does not look like a version problem. The repo is pnpm-only — `preinstall` rejects npm/yarn.

- `pnpm test` — run unit + integration tests (vitest)
- `pnpm check:illustrator-fixtures` — audit the real Illustrator fixture registry against tracked artifacts
- `pnpm test:visual` — run Playwright visual regression tests
- `pnpm run typecheck` — type check without emitting
- `pnpm build:extendscript` — build both ES5 bundles: `dist/extendscript/all2html-core.js` (the IR pipeline, from `src/extendscript/index.ts`) and `dist/extendscript/all2html-ae-core.js` (After Effects helpers only, from `src/extendscript/ae-index.ts`)
- `pnpm build:after-effects` — build the extendscript bundles, then assemble `dist/after-effects/all2html-ae.jsx` (json2 string + player template string + AE helper bundle + `exporter.jsx`) and the release zip
- `pnpm build:figma` — build the runnable Figma plugin to `plugins/figma/dist/`
- `pnpm build:illustrator` — build assembled Illustrator plugin (~190KB)
- `pnpm build:panel` — build Illustrator panel package from source
- `pnpm package:panel` — build Illustrator bundle + signed panel package
- `pnpm package:panel:zip` — build Illustrator bundle + panel zip **and** the signed `.zxp` (the zip target signs first, then wraps; see `internal-docs/cep-panel-architecture.md`)
- `pnpm diagnostics:illustrator` — read structured CEP diagnostics from the Illustrator host
- `pnpm diagnostics:after-effects` — read structured CEP diagnostics from the After Effects host
- `pnpm exec tsx src/cli/index.ts render <ir.json> -o <dir> [--format html|standalone|svelte|react] [--verbose]`
- `pnpm exec tsx src/cli/index.ts watch <ir.json> -o <dir> [--format html|standalone|svelte|react] [--verbose]` — watch mode
- `pnpm exec tsx src/cli/index.ts import svg <input> -o <dir> [--format ...] [--verbose]` — import SVG files directly
- `pnpm exec tsx src/cli/index.ts validate <ir.json>` — validate IR schema
- `pnpm check` — the full gate: lint + root typecheck + 3 panel typechecks + doc citations + test
- `pnpm build` — clears `dist/` then `tsc -p tsconfig.build.json`; produces the publishable package. CI runs it, then `node scripts/check-package-entrypoints.mjs`. The clean is not optional: `files` publishes `dist/**/*.js`, so a module deleted from `src/` otherwise stays in the tarball — `dist/emitters/shared/hast-helpers.js` lingered that way with a value import of a package that had moved to devDependencies. Run it *before* `build:illustrator`/`build:panel`, not after: it also removes `dist/all2html.js` and `dist/after-effects/`.
- `pnpm check:generated-docs` — assert `docs/reference/{settings,support-matrix}.md` still match the definitions they are generated from
- `pnpm check:doc-citations` — assert every source citation in `CLAUDE.md`, `PROGRESS.md`, `SPEC.md` and `internal-docs/*.md` still points at code that supports it. Two citation forms: `path:12` / `path:12-34` (the cited lines must contain an identifier named in backticks beside the citation) and `path#symbolName` / `` `symbolName` in `path` `` (the symbol must exist in that file). Prefer the symbol form — line numbers rot on the next commit, which is how this doc set broke three times on one branch. Path fragments must be unambiguous: bare `exporter.jsx` matches both the Illustrator and After Effects exporters and is rejected
- `pnpm check:release-artifacts` — assert every release artifact was produced and is non-empty (CI Artifacts + release workflows)
- `bash scripts/test-illustrator.sh` — run all .ai files through Illustrator (needs AI running)
- `pnpm exec tsx scripts/generate-illustrator-hardening-fixtures.ts [fixture...]` — regenerate the scripted real Illustrator `.ai` fixtures (pass names to avoid rewriting unrelated binaries)
- `pnpm exec tsx scripts/export-illustrator-fixtures.ts --golden [fixture...]` — re-export tracked Illustrator fixtures through the real bundle and refresh saved outputs/goldens
- `pnpm test -- figma-plugin figma-runtime figma-ui-model figma-fixtures figma-pipeline` — focused coverage for the Figma plugin beta surface and hardening corpus

## Architecture

**Pipeline:** IR JSON → `loadAndValidateIR` → `resolveSettings` → `computeBreakpoints` → `computeStyles` → `deduplicateStyles` → `computePositions` → `groupArtboards` → emitter → optional output bundle

Each transform takes a phase-typed document and returns the next phase:
`Document` → `ResolvedDocument` → `BreakpointedDocument` → `StyledDocument` → `DeduplicatedDocument` → `EmitterReadyDocument`

**Phase rule:** every intermediate document carries an explicit `pipelinePhase` literal (`PhaseDocument<P>` in `src/ir/types.ts`). The literal — not the presence of extra fields — is what makes the phases mutually unassignable, so a transform can be neither skipped nor run twice. Phase documents are internal: the persisted canonical IR is always the validated source `Document`, and `Document.pipelinePhase` is a type-level `never` marker that never exists at runtime.

**Boundary rule:** Input plugins (e.g. ExtendScript) extract data the design tool knows. The core handles everything tool-agnostic (CSS, positions, breakpoints, HTML).

**IR rule:** `Document.irVersion` is currently `"0.1.0"`. Documents must include `source`, artboards/layers must include stable IDs, assets must reference those IDs via `artboardId`/`layerId`, and font mappings use `sourceFont`.

**Figma rule:** `plugins/figma/` must target the canonical IR directly. Selected top-level frames are the only v1 export roots. Same-base-name frames form responsive groups; duplicate widths in one group are a hard error.

**Output bundle rule:** Shared bundles include `ir.json`, emitted output files, extracted assets, and `manifest.json`. The manifest is the machine-readable inventory and must match the serialized bundle contents.

**Bundling:** The core compiles to an ES5 IIFE that runs inside Illustrator's ExtendScript runtime. The assembled `dist/all2html.js` is one self-contained file (json2 polyfill + ES5 polyfills + core bundle + exporter). No Node.js required.

## Key Conventions

- IR documents must include `irVersion` (currently `"0.1.0"` pre-release)
- IR documents must include `source`; source-native names/IDs belong under `source`, not ad-hoc top-level fields
- Artboard/layer IDs must be stable and unique inside the document. File importers should include enough path/source context to avoid basename collisions.
- All positions in **static-scene** IR are absolute pixels, top-left origin, per-artboard coordinate space. This is a static-scene rule, not a global IR rule — temporal scenes key to time and map scenes carry a geographic space (SPEC.md §12.10).
- IR `letterSpacing` is in em units (CSS-ready). Exporters convert from tool-native (e.g., AI tracking / 1000)
- IR `opacity` fields are 0-100 scale (Illustrator convention). Core converts to CSS 0-1
- Asset record keys must equal `asset.id`. Asset `artboardId`/`layerId` references must point at real canonical IDs. Paths are relative to IR file directory
- Font mappings use `sourceFont`; keep legacy names like `aifont` only in explicit compatibility adapters/panel state
- `metadata` accepts arbitrary extra keys (JSON-serializable values). The core pipeline must never read or branch on non-typed metadata keys — they are passthrough for emitters/consumers only.
- Plugins must target the canonical IR types/schemas in `src/ir/`. Do not define shadow IR contracts inside plugin directories.
- Figma plugin config is JSONC stored as document-local plugin data. Keep it thin: canonical `settings`, `metadata`, `fonts`, `customBlocks`, and `emit` only. `emit` is the canonical `EmitterConfigSchema` from `src/emitters/types.ts` — byte-for-byte the block the CLI reads — so `positionMode`, `allowUnsafeHtml` and `responsiveImageMode` reach Figma through the same contract. Do not define a Figma-local emitter shape.
- Figma plugin persistence: shared config lives in `figma.root` plugin data; local convenience state (currently output format, preset, and disclosure state) lives in `figma.clientStorage`.
- Figma plugin delivery is ZIP-first: export `ir.json`, `manifest.json`, emitted HTML/standalone files, and any extracted asset bytes together. Do not add a Figma-only render path.
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
- The HTML emitter builds a serializable node tree and **passes raw values only**. All escaping happens once, in the serializer (`src/emitters/shared/html-node.ts`), which picks the grammar from the node's position in the tree. Escaping at a builder call site would double-escape
- Config files use JSONC (parsed with `jsonc-parser` in Node, `//` stripping in ExtendScript)
- There is **one** HTML emitter (SPEC §12.6 / D23): `src/emitters/html-tree.ts` builds a plain-object node tree, `src/emitters/shared/html-node.ts` serializes it, and `html.ts` is the single re-export entry point onto it — every surface including the ExtendScript bundle imports `emitHTML` (the `html-string.ts` / `emitHTMLString` alias was deleted). Do not reintroduce a parallel implementation — the byte-parity bug class is now retired by construction, not by test. `src/emitters/shared/to-hast.ts` keeps a hast adapter for rehype-based post-processing; nothing in the repo consumes it at runtime, but `test/unit/html-serializer.test.ts` renders every IR fixture through it and asserts byte equality, which is what keeps the escaping subsets pinned to hast's own
- After rebuilding core, must also `pnpm build:extendscript` before bundle tests pass
- ExtendScript has no ES2015+ *runtime APIs*; transpilers lower syntax but never polyfill APIs. `test/integration/es5-runtime-apis.test.ts` scans every shipped ExtendScript artifact and the panel `src/jsx` sources. Its allowlist is derived from `src/extendscript/polyfills.ts` — add the polyfill there rather than editing the test
- Tests that inspect build artifacts must go through `test/helpers/extendscript-build.ts`, which rebuilds when an artifact is missing **or older than its inputs**. Existence checks alone let a stale `dist/` satisfy the ES5 guard while the current sources are broken
- All three shipped ExtendScript artifacts — the ES5 core bundle, the assembled `dist/all2html.js` users install, and `dist/after-effects/all2html-ae.jsx` — are guarded against checked-in baselines (`test/fixtures/extendscript-bundle-baseline.json`) plus a growth tolerance, not a fixed cliff. Size, delta, and headroom print on every test run, and any growth above the recorded baseline is reported as UNATTRIBUTED DRIFT. Raising `bytes` is allowed but must be a deliberate, reviewed commit, and the last `history` entry must state the new number — the test fails otherwise
- `SAFE_SETTING_IDENTIFIER_RE` (and the `SAFE_IDENTIFIER_SETTING_KEYS` derived from the `string-safe` setting kind) lives in `src/ir/settings-definitions.ts` and is re-exported from `src/ir/schema.ts` — the pattern must not be restated. `isValidSettingValue()` derives the complete Zod-free settings boundary (types, enums, ranges and safe identifiers) from that same definition table. Illustrator calls it before persisting `ir.json` and again after precedence resolution, falling back to the declared default and warning `setting:invalid-value`; do not add another exporter-local settings validator
- Panel/docs help copy for settings lives in `src/ir/setting-help.ts`, never on `SETTING_DEFINITIONS`. That table is imported by the ExtendScript bundle and rollup cannot tree-shake object properties, so help copy on it ships into Illustrator (it cost 8,706 B). Nothing in `src/extendscript/` may import `setting-help.ts`
- HTML escaping inside `src/emitters/` is single-sourced in `src/emitters/shared/escape.ts` and **deliberately narrowed to match `hast-util-to-html`'s subsets** (text: `&` `<`; double-quoted attributes: NUL `"` `&` `'` backtick) so the serializer and the `toHast()` adapter stay byte-identical. hast offers no way to *widen* its escaping, so matching it was the only route to byte-identity. Do not add a local escape helper inside `src/emitters/`, and do not "fix" the narrowness without re-proving parity
- **No** escape helper survives outside `src/emitters/shared/escape.ts`. The two browser surfaces that used to fork one — `plugins/figma/src/ui-entry.ts` and `apps/svg-dropzone/src/app.ts` — import the shared pair, which is why `escape.ts` exports the grammars *split*: `escapeHtml()` for text, `escapeAttr()` for double-quoted attribute values. The split is the precondition for sharing, not a nicety — the dropzone's local copy escaped `"` and was used in an attribute position (today `escapeAttr` in `apps/svg-dropzone/src/app.ts`), so dropping in the narrowed text-only helper would have opened a hole. The last allowlisted fork, `plugins/after-effects/exporter.jsx`, was retired the same way: ExtendScript cannot import TypeScript, but the *artifact* can concatenate a bundle, so the exporter now calls `escapeAttr` through `All2HtmlAE`. `test/unit/escape-single-source.test.ts` scans `src`/`plugins`/`apps`/`scripts`/`test` for any `escape*Html|Attr|Xml*` definition and allowlists exactly one file by **path**, so a new fork anywhere fails the suite. One grammar legitimately lives elsewhere: `escapeInlineJson` in `src/extendscript/ae-index.ts`, which escapes `</` and U+2028/U+2029 for JSON spliced into an inline `<script>` — neither `escapeHtml` nor `escapeScriptContent` is that grammar
- `script` and `style` are raw-text elements: the serializer runs their `text` children through `escapeScriptContent()` / `escapeStyleContent()` instead of HTML-escaping them, so a custom block cannot break out. Passing a `raw()` child into either element bypasses that and must be deliberate. `escapeScriptContent()` deliberately does **not** rewrite `<!--` — that corrupts valid author JS (`/<!--/u` becomes a SyntaxError, and no escape of it parses in Unicode mode). It appends `\n-->` when `<!--` is present instead, which returns the tokenizer to script-data state before the closing tag. Do not "restore" the rewrite; see `src/emitters/CLAUDE.md` for the containment argument
- Use the `ObservableLogger` interface for pipeline observability — pass via `options.logger` to `processDocument()`. Default is `noopLogger` (zero overhead). Use `createConsoleLogger()` for CLI verbose mode, `createCollectingLogger()` for tests.
- Node-tree attributes are an **ordered array of `[name, value]` pairs**, not an object: ES3 does not define `for...in` order and ExtendScript's `Object.keys` is a `for...in` polyfill, so object key order was unspecified in the shipped artifact. `undefined`/`null`/`false` omit the attribute; `true` emits a bare boolean attribute.
- Emitter registry (`src/emitters/registry.ts`): all emitters return `{ files: EmitFile[], warnings }` via `emitAll(doc, groups)`. CLI uses `getEmitter(format)` — no if/else dispatch.
- There is no runtime emitter/importer registration. The emitter tables (`src/emitters/registry.ts`, the browser table in `src/browser.ts`) are fixed at construction with the built-ins and export no mutators; `registerEmitter`/`registerBrowserEmitter` were deleted with zero call sites. The importer registry is deleted entirely — the CLI calls the SVG importer directly, and a registry returns when a second importer exists. Do not add public third-party plugin loading.
- Browser apps should use `src/browser.ts` orchestration helpers such as `convertLoadedSvgFilesInBrowser` instead of duplicating import/process/emit/bundle logic.
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

These are specced but NOT implemented yet:
- SnippetElement rendering (v1.1) — IR types exist; `shared/replaceable-nodes.ts` is written but imported by no emitter
- Tagged text bindings (v1.2) — `data-binding-path` is emitted but inert
- onMounted/onArtboardChange callbacks (v1.2)
- Global config file (`~/.all2html/config.json`) (v2)

(CSS custom property image loading is **shipped**, not deferred — `src/emitters/shared/css.ts`. `positionMode: "percentage"` is also shipped.)

## Known Broken — do not assume these work

Verified against the code. Fix or remove; do not build on top of them.

- **`imageFormat: svg` and `png24` still produce PNG8 on Illustrator** — `exportArtboardImage` in `plugins/illustrator/exporter.jsx` branches only jpg vs `ExportType.PNG8`. No longer *silent*: the value warns through the `partial` declaration (`values: ["auto","png","jpg"]`), and the panel select renders `png24`/`svg` disabled and labelled "not supported" (`gateOptions` in `plugins/illustrator/panel/src/js/capability.ts`, applied at `ImageSettings.svelte:59`). A stored value still displays rather than vanishing. The exporter is unfixed; only the way in is now honest.
- **Illustrator emits HTML only.** `processAndEmit` calls the HTML emitter directly; the emitter registry is unreachable from that surface (it imports the Node-only Svelte and React emitters). Standalone/Svelte/React are CLI-only. Figma does html + standalone. `output: multiple-files` *is* honored — the bundle groups artboards and returns one file per group — but every file is HTML.
- **After Effects loads helpers from the core, not the pipeline.** `build:after-effects` concatenates `dist/extendscript/all2html-ae-core.js` (rolled up from `src/extendscript/ae-index.ts`: ES5 polyfills + `emitters/shared/escape.ts` + `emitters/shared/google-fonts.ts`) ahead of `exporter.jsx`, which retired the forked google-fonts and escaping copies (D13). It still constructs **no IR**, runs no transform and never calls `checkSurfaceCapabilities`, so `runtimeChecked: false` stands. Do not read the bundle slot as "AE is on the core".
- **20 settings cells are DEAD** — a control accepts the value, the export succeeds, nothing happens. 31 were catalogued; two were closed rather than declared: D10 (Illustrator `output`) and D31 (`useLazyLoader` on video); nine more were closed by deleting their settings outright — `writeImageFiles` (D3–D5), the document-level `inlineSvg` setting (D16–D18), and `svgIdPrefix` (D19–D21) had zero readers on every surface (the per-layer `Layer.inlineSvg` flag remains). Three of the remaining 20 (Figma `pngTransparent`, `pngNumberOfColors`, `use2xImages`) are dead *at their default*, so those still warn on every Figma export — they were never implemented. The number lives in three places that must agree: this bullet, the header of `internal-docs/capability-matrix.md`, and the `DEAD_CELLS` length assertion in `test/unit/capabilities.test.ts`. Full table with file:line proof in the matrix; check it before assuming any setting works on any surface.

## Contract Rules

These encode failures that have already happened. Treat them as hard rules.

- **The document model must survive a JSON round-trip.** No `Infinity`, `NaN`, `undefined`, `Map`, or `Set` anywhere in it. Use optional/absent instead of sentinels. Enforced per transform by `assertJsonPure()` (`src/core/json-purity.ts`).
- **Phase types must make the previous phase's uncertainty unrepresentable.** If a transform can be skipped without a type error, the phase type is decoration. Never fabricate a placeholder value to satisfy a later phase type — add the missing phase instead. Model a variant that transforms skip (image-rendered text) as its own type rather than casting past it, and never re-admit an earlier phase's element variants into a later phase's layer union: every `"computedX" in el` probe in an emitter is a phase-type defect. `test/unit/pipeline-phase-types.test.ts` pins this down with `@ts-expect-error` assertions that `pnpm run typecheck` enforces.
- **No forked helpers between exporters and core.** If an exporter needs tool-agnostic logic, export it from an `src/extendscript/` bundle entry and load the bundle. Hand-copied ES5 forks are how `groupWarnings` and the google-fonts helpers drifted. There are two entries, and the split is deliberate: `index.ts` is the IR pipeline Illustrator calls, `ae-index.ts` is a helper-only bundle (13.5 KB against the pipeline's 118 KB) for a surface that constructs no IR. Reach for a second entry rather than a fork when a surface needs helpers without the pipeline. Enforced by `test/unit/escape-single-source.test.ts` (which now allowlists only `src/emitters/shared/escape.ts`) and `test/integration/after-effects-shared-helpers.test.ts`.
- **The product boundary is "a graphics desk person needs to embed this in a web page," not "responsive positioned text."** Motion work (After Effects today; Lottie, Rive, Cavalry plausibly later) is in scope. Do not infer product scope from code sharing — if a surface shares little with the core, that is evidence the contract does not generalize yet, not evidence the surface is a different product. See SPEC.md §12.9.
- **A surface must not accept a setting it does not honor.** Silently ignoring a value is worse than rejecting it. If a surface cannot act on a setting, it warns; if a UI cannot act on it, it does not show the control. This is enforced by the declarations in `src/core/capabilities.ts`: every surface declares its settings as `honored` / `partial` / `unsupported` / `na`, and `processDocumentShared` warns (`setting:unsupported`) for anything the surface will not produce. **Compare the request against what the surface actually does, never against the global default** — a default the surface does not implement is exactly the case the warning exists for, and comparing against it is wrong in both directions (see D25). Declare the real behavior with `divergesAtDefault`; defer content-dependent gaps to the emitter with `warnedByEmitter`. Adding a capability means editing that table, not adding a conditional. Surfaces must pass their identity through `options.surface`, including `format`. After Effects is declared but not enforced (`runtimeChecked: false`) — it loads the helper bundle, not the pipeline, so nothing there can call the checker.
- **Emitter parity is asserted on adversarial input, not fixtures.** Any test that only proves output *exists* (`length > 100`, no `NaN`) proves nothing. Assert that a given setting changes the output in a specific way.
- **Untyped Illustrator input is normalized once, at the boundary.** `all2html.config.json` (`JSON.parse`), the CEP panel payloads, and document text blocks reach the exporter with no schema, and Illustrator cannot run Zod. `normalizeIllustratorInputs` in `plugins/illustrator/exporter.jsx` is the one place those values become typed exporter input; after it, `runExporter` reads no raw `docSettings` key and no raw font entry. Do not add a tenth ad-hoc read. The defect class is not "fonts" or "non-setting keys" — `project_name` is a canonical setting and still crashed `makeKeyword`, because the raw value was read *before* the settings boundary ran, and the same key normalized twice named two different artifacts. `inputs.settings` IS the canonical bag, built inside the boundary, never a copy: a second settings bag is the failure baseline entry 218443 eliminated. String settings accept strings only (`readStringSetting`); fonts and known metadata strings have per-field policy, and structural values warn and fall back rather than stringifying to `"[object Object]"`.
- **Warnings carry a structured code, not English prose.** `StructuredWarning` in `src/core/warnings.ts` has `code`, `category`, `message` and optional `artboardId`/`layerId`/`elementId`/`setting`/`surface`. Assign the code and category **at the call site**; never classify by matching the message. Public results keep `warnings: string[]` as a projection of `structuredWarnings` — do not remove it, the manifest and every surface UI read it.

## Surface-Specific Gotchas

- **Special-layer tag syntax differs by tool and the docs currently merge them.** Illustrator splits on the *first* colon (`extractLayers` in `plugins/illustrator/exporter.jsx`) and accepts `:svg,inline` or `:inline`. Figma accepts `:svg:inline`. `:svg:inline` on an Illustrator layer matches nothing and falls through to the unrecognized-tag warning.
- **The Illustrator `all2html.config.json` needs snake_case keys.** `runExporter` in `plugins/illustrator/exporter.jsx` merges config → panel → text block into one `docSettings` bag read as `docSettings.project_name` (`illustrator/exporter.jsx#project_name`). The camelCase rule applies to the IR and the core config, not to that file. Illustrator settings precedence is `config file < panel < text block`.
- **`htmlOutputExtension` only reaches the html emitter.** Illustrator honors it; the CLI, browser and Figma declare it `partial` with `unsupportedFormats: ["standalone", "svelte", "react"]` in `src/core/capabilities.ts`, so setting it while emitting one of those formats warns instead of silently doing nothing (svelte/react force `.svelte` and `.jsx`/`.tsx`, standalone always writes `.html`).
- **Illustrator block/layer names accept `all2html-` and `ai2html-`.** The matchers are the three regexes declared above `parseSpecialBlocks` (`exporter.jsx`): `SPECIAL_BLOCK_RXP` (typed blocks), `SPECIAL_NAME_RXP` (any special name), `SETTINGS_BLOCK_RXP` (settings block/layer). Precedence when a document carries both settings/text blocks: **`all2html-` wins key-by-key**, order-independent, with uncontested `ai2html-` keys kept. Custom code blocks do not conflict and are collected in document order. The settings frame keeps whichever spelling the user typed, so `findSettingsTextFrame` tries both. This is INPUT recognition only — emitted class names and output markers are unchanged. Pinned by `test/unit/illustrator-block-prefixes.test.ts`, which derives the regexes from the shipped file.
- Artboards whose names start with `-` are skipped entirely.

## Reference

- `SPEC.md` — the **target** design. Aspirational, not a description of current behavior.
- `PROGRESS.md` — what is actually built. This is the accurate one; trust it over SPEC.md.
- `internal-docs/capability-matrix.md` — which settings and features each surface actually honors
- `research/ai2html-feature-spec.md` — exhaustive ai2html feature catalog (1348 lines)
- `research/ai2svelte-feature-spec.md` — Reuters ai2svelte analysis (CEP extension, snippets, tagged text)
