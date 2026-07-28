# Product Decisions Log

Decisions made during the architecture cutover, recorded for later review. Each entry states the decision, the evidence behind it, and what would reverse it.

Status key: **[decided]** acting on it · **[pending]** awaiting review input · **[reversed]** superseded

---

## D1 — After Effects is in scope [decided]

The product boundary is *"a graphics desk person made a thing and needs to embed it in a web page,"* not *"responsive positioned text."* Motion work sits inside that boundary.

An earlier draft inferred product scope from code sharing — because the AE exporter shares nothing with the core, maybe it was a different product. That reasoning is backwards. Code sharing describes how well the contract generalizes; it does not define the product.

**Reverses if:** desks turn out not to want motion embeds from this tool.

---

## D2 — Rive is out of scope [decided]

`.riv` is a compiled binary; the format is documented only at a high level. Rive uses state machines rather than fixed timelines, so there is no clean "static frame + extractable text" projection. Research found **no primary evidence of Rive adoption at any named newsroom** — it appears mostly in product/UI design commentary.

Rive remains useful as a *pressure-test case* for the `external` scene kind. It is not a planned surface.

**Reverses if:** a desk asks for it.

---

## D3 — Lottie / dotLottie is the priority future surface [decided]

Open, documented JSON. It is the actual After Effects → web bridge that desks already use (Bodymovin is the de facto standard export). It is the same source tool we already support, so it costs the user nothing new to learn.

The interesting capability: extract text layers as **live HTML over a Lottie-driven vector background** — the same trick all2html already does for static graphics, applied to motion. That is strictly better than the current rendered-video path: scalable, smaller, and the text stays selectable and accessible.

Confirms the §12.10 finding that scene kind belongs to the export, not the surface: one AE composition, two exports (`temporal-raster` and `temporal-vector`).

---

## D4 — Chart/embed services are not importers [decided]

Datawrapper, Flourish, Highcharts, Tableau. All closed to extraction, and all already solve their own embed story (Datawrapper ships three embed templates including a responsive Web Component and a `noscript` image fallback carrying alt text).

Note the tension: the 2023 State of Data Journalism survey found **51% of respondents predominantly or entirely use external graphic tools**. That is a large constituency all2html does not serve. It is the strongest argument for the `external` scene kind — see D9, pending.

---

## D5 — Invest in emitters and publishing over new importers [decided]

The strongest evidence in the research. **Every fork in the ai2html lineage added value on the publishing side, not the extraction side:**

- `reuters-graphics/ai2svelte` → responsive Svelte components, preset styling, font config
- `mcclatchy/svelte-adobe-illustrator` → `.ai` filename drives a GCS bucket path and the CUE CMS embed code
- `the-dataface/figma2html` → zipped bundle, variable text placeholders, automatic Google Fonts, resizer script
- `nprapps/pym.js` → exists *solely* because graphics injected into a CMS collide with host CSS/JS

Extraction is a solved problem. Delivery is not. This is direct evidence for the envelope-is-the-product thesis in SPEC §12.10, and it means the Svelte/React emitters are a real product commitment, not a checkbox — see D8.

---

## D6 — Fonts are a first-class feature, not a setting [decided]

The single most-cited ai2html pain point in the research. Adobe fonts do not map cleanly to web fonts; `newsdev/ai2html` issue #6 ("Make it easier to add your own fonts") is long-standing; there is a widely-shared public gist devoted specifically to fixing font issues on ai2html exports.

Current state: font mapping is a `fonts[]` array in the IR with a panel mapper UI, and missing fonts silently substitute defaults. That is not enough. Fonts deserve: detection of unmapped fonts *before* export with an actionable prompt, a sensible built-in mapping table for common Adobe fonts, and a warning that names the specific font and the artboard it appears on.

---

## D7 — CMS survival is our responsibility [decided]

Research surfaced two distinct failure modes that practitioners actually hit, both of which we currently push onto the user:

1. **The "chart monstrosity"** — JS/CSS conflicts in the CMS break the resizer, and every breakpoint renders simultaneously. There is public practitioner writing arguing for pure CSS media queries over the JS resizer for exactly this reason. Our container-query approach is already the better answer; we should say so and make the degradation path explicit.
2. **Host CSS/JS collision** — the entire reason `pym.js` exists. Our output currently leaks one unnamespaced global class (`class="ai2html"`) and emits non-slug-prefixed element ids (`g-ai0-1`), so two graphics on one page collide.

This is the bidirectional capability declaration from §12.10 pointed at a real problem: the output should declare what it requires of its host.

---

## D8 — Svelte and React are real emitters [decided]

The alternative was to demote them to "HTML wrappers" and say so in the docs. Rejected: Reuters built an entire ai2svelte fork to get component output, and Svelte/SvelteKit is now the dominant newsroom rig framework (The Pudding's `svelte-starter`, Reuters' `bluprint_graphics-kit`, Guardian's `interactive-atom-*-svelte`). Component output is where the graphics land.

This makes the currently-broken Svelte emitter a P0, not a curiosity, and it means `shared/replaceable-nodes.ts` — written to enable snippets and bindings, imported by nothing — should be wired up rather than deleted.

---

## D9 — The `external` scene kind is dropped [decided]

Adversarial review killed it, and the research independently agrees. Two arguments I could not answer:

1. **There is no entry point.** Every surface is Illustrator, After Effects, Figma, or an SVG dropzone. Nobody opens Illustrator to wrap a Datawrapper iframe. The user with an external chart already has an embed code.
2. **We would own failures we cannot see.** all2html renders nothing, does not own the runtime, and cannot preview it faithfully — but inherits third-party version skew, CSP and sandbox behavior, and a new bidirectional host-requirement mechanism. "My Rive file doesn't work in our CMS" becomes an all2html support ticket.

The 51%-use-external-tools statistic is real but does not imply those users want *us* to wrap their embeds. That was invented generality, and it was the rationalized decision in my design.

If envelope-only ever matters, it is `scene: null`, not a kind.

---

## D13 — The envelope/scene split is deferred, not adopted [decided]

**Reversal of my own proposal.** I had this as the centerpiece of the contract phase. The cost was never counted; when counted, it does not clear the bar.

Measured cost: **46 `.artboards` call sites in `src/`, 52 in `test/`, 72 JSON fixture files**, plus the `artboards` field in `src/ir/schema.ts`. Roughly 170 sites — to introduce a three-member union with **one member implemented**. Dropping `external` (D9) makes it a two-member union with one member implemented, which is worse: a tagged union with a single arm is just a type with extra ceremony.

The headline justification was that it "retires the AE exporter's forked helpers." That is worth ~200 lines of dedupe. The claim in SPEC §12.8 that AE joining the core "costs one extra build-script slot" was wrong: `plugins/after-effects/exporter.jsx` contains **zero** occurrences of `irVersion` or `artboards`. It never constructs IR at all. Putting AE on the core means inventing the temporal scene, a Composition schema, Zod validation, a temporal emitter, fixtures, and goldens. That is the largest item in the plan, and it was priced as free.

**What we do instead:**
- Export `shared/google-fonts.ts` and one escape helper through `src/extendscript/index.ts`; give AE the bundle slot. ~90% of the dedupe benefit, zero contract churn — and it tells us empirically whether AE needs a scene type.
- Add `Artboard.relationship: "alternates" | "sequence"` as **one field**. The modelling gap in §12.10.5 is real and does not need the split to land.
- Keep `Document` as-is. If a second scene kind actually ships, add `scene` as an optional discriminated field then. We get the seam without paying for it twice.

The greenfield/no-users license is real, but it is a license to change things *we need to change*, not a reason to pre-build abstractions for one implemented case.

---

## D13b — The envelope I specified was the wrong envelope [decided]

Independent review returned **"no-go as written"** on a sharper ground than cost. My `Envelope = {irVersion, source, metadata, settings, fonts, customBlocks, assets}` would have **moved static coupling without removing it**, then frozen it into a contract advertised as universal:

- **`Settings` is predominantly static-renderer policy**, not universal document config — `imageFormat`, `responsiveness`, `renderRotatedSkewedTextAs`, `includeResizerCss`, `inlineSvg`, promo images. A temporal export would have been obliged to carry `renderRotatedSkewedTextAs`.
- **Assets are structurally artboard-bound today.** `Asset.artboardId` is required (`schema.ts#artboardId`, `z.string().min(1)`) and cross-validated against the artboard/layer graph (the document `superRefine` in `src/ir/schema.ts`). Asset lookup is indexed by artboard and layer (`shared/assets.ts#buildScopedAssetIndex`). An "envelope" asset would have to pretend it belongs to an artboard.
- **Custom blocks are output injections**, consumed directly by the HTML and CSS emitters — not source-independent document metadata.

Committing that boundary first was assessed as the single highest-risk item in the whole plan: it bakes today's static coupling into the "universal" contract and forces a *second* schema cutover the moment AE or an external runtime becomes a real consumer.

**The correct decomposition, when we do this:** keep only identity, provenance, and editorial metadata universal (`irVersion`, `source`, `metadata`). Put scene-specific configuration **and resources** beside the scene. If a unified resource catalog is ever wanted, ownership must be generic — `{ owner: { kind: "scene" | "node"; id: string } }` — not a mandatory `artboardId`.

This reinforces D13 (defer) rather than contradicting it, and it means the deferred design in SPEC §12.9 must be revised before it is ever picked up.

---

## D14 — "Phase 3 removes more code than it adds" is retired as a metric [decided]

Attacked independently by both reviewers, which is what convinced me.

It rewards deleting `html.ts` (523 lines) over single-sourcing the escaping contract; rewards deleting `core/warnings.ts` grouping over implementing it; and **penalizes writing tests**, since tests are lines — which is precisely the deficit the plan is meant to fix.

**Replacement metrics**, both countable and behavior-linked:
- Number of runtime `"in"`-checks and property-sniffing guards removed from the emitters and transforms.
- Number of settings that no longer silently no-op on any surface.

If code volume is measured at all, measure `src/`, not `test/`.

---

## D15 — Test the surfaces, not the assertions [decided]

**Reversal.** I diagnosed `output: multiple-files` shipping broken as a symptom of weak test assertions ("existence, not behavior"). That diagnosis is wrong.

`test/integration/multiple-files.test.ts` is genuinely behavioral: it asserts group count, per-group artboards and widths, slug uniqueness after sanitization, per-file id prefixing, and cross-contamination. It passes, and it is correct.

The actual cause is `src/extendscript/index.ts#processAndEmit` — at the time a hardcoded six-step pipeline that never called `groupArtboards` and returns `{ html: string }`, a shape that **cannot express multiple files**. It is a *surface coverage gap*, not an assertion-quality gap. Rewriting assertions across 723 tests would not have found it.

**Instead:** one test per surface entry point, running shared fixtures through that surface's real path and asserting file count and format. That harness is what makes every later phase verifiable, and it is cheap.

The adversarial-input parity fixture is still worth adding — that bug is real and fixtures genuinely cannot see it. But it is a targeted addition, not a suite-wide rewrite.

---

## D16 — Dead code is guilty until proven dead [decided]

"Delete dead code first" was too blunt and would have destroyed evidence. `groupArtboards` is dead *from Illustrator* but alive from `pipeline-shared.ts#groupArtboards`. `core/warnings.ts` grouping is dead while a hand-copied ES5 fork (`illustrator/exporter.jsx#groupStructuredWarnings`) is what users actually see.

In this codebase, dead code is usually an **unwired feature**, not a removed one — which is the same insight as §12.10.5 (`multiple-files` was a modelling gap, not laziness).

**Rule:** dead code either gets a test pinning its intended caller, or a deletion that names its replacement. No silent removals.

---

## D18 — Vertical cutovers, not horizontal phases [decided]

My phasing was *ground truth → all contracts → all deletion*. Review found a dependency inversion: "settings resolve once in the core" and capability enforcement have **no executable consumer** until the surfaces are integrated, because Illustrator pre-merges config/panel/text-block settings before the core is ever called (`illustrator/exporter.jsx#loadConfigFiles`) and derives a *second* exporter-local settings object that drives image extraction before the core runs (`illustrator/exporter.jsx#exportImages`). Leaving surface integration to Phase 3 strands the Phase 2 contracts with nothing exercising them.

**Revised shape — one complete path at a time:**
1. Characterization tests + capability inventory *(done — `capability-matrix.md`)*
2. Define the envelope plus **one complete static-scene path**
3. Cut Figma, SVG, CLI, browser, and Illustrator onto that path, including labelled settings layers and grouping
4. Define and cut the temporal path with After Effects
5. Only then generalize declarations, doc generation, and deletion

**Corollary — do not repair `multiple-files` on the old contract.** Fixing it now means investing in the setting-driven, name-inferred grouping in `group-artboards.ts#groupArtboards` that `alternates | sequence` is meant to replace. Characterization tests precede the contract; contract-sensitive *fixes* belong in the vertical cutover.

---

## D19 — Wiring grouped output into Illustrator is blocked on ES3 [decided]

Concrete blocker I had not found. `src/core/group-artboards.ts` used `new Map` twice, and `test/integration/extendscript-bundle.test.ts` forbids emitted `Map`/`Set` constructors (`Map` in `test/integration/extendscript-bundle.test.ts`) because ExtendScript lacks them. That is *why* `src/extendscript/index.ts` bypasses grouping and emits a single HTML string — it is not an oversight.

So `output: multiple-files` on Illustrator is not "missing wiring." It requires making `groupArtboards` ES3-safe first. Sequence: make it ES3-safe → include it in the bundle → widen the return shape beyond `{ html: string }`.

---

## D20 — Phase types get a literal discriminator [decided]

Structural typing means additive phase fields do **not** prevent skipping a phase — `computeBreakpoints` currently accepts and returns the same `ResolvedDocument`, so calling it twice or never is type-correct. "Extra fields per phase" cannot fix that on its own.

The contract is a phase-indexed document carrying an explicit `pipelinePhase` literal, with per-phase field types selected by that literal. Each transform's signature then names the exact phase it consumes and produces, and later phases are not structurally assignable to earlier ones.

Two riders:
- **Image-rendered text becomes its own discriminated variant** at validation time, which removes the cast in `src/core/compute-styles.ts` *and* the placeholder `computedPosition: { width: "" }` inserted by `deduplicate-styles.ts#computedPosition` before positions exist.
- **Phase documents stay internal.** The persisted canonical IR remains the validated source document; bundles already serialize the original IR (`output-bundle.ts#createOutputBundle`). Serializing intermediate phases would expand the long-term contract for nothing.

**Implemented.** `PhaseDocument<P>` in `src/ir/types.ts`, with a distinct `breakpointed` phase between resolved and styled and a distinct `deduplicated` phase between styled and emitter-ready. `Document.pipelinePhase` is a type-level `?: never` marker, which is what also stops a phase document being fed back to `resolveSettings` or serialized as IR. Both placeholders are gone, both casts are gone, and all 12 runtime `"in"`-probes in the transforms and emitters are gone. `test/unit/pipeline-phase-types.test.ts` holds the negative assertions as `@ts-expect-error` lines that `pnpm run typecheck` enforces. ES5 bundle went *down* 279 B.

---

## D21 — JSON purity needs per-transform invariants, not one round-trip test [decided]

Zod rejects non-finite numbers at *input* (`schema.ts#JsonLiteralSchema`), but computed documents have no equivalent check, which is exactly how `compute-breakpoints.ts#Infinity` introduced it unchallenged. A single round-trip test is necessary but not sufficient — transform boundaries assert finite-number invariants on their output (`src/core/json-purity.ts`).

**Which boundaries, and why not all of them.** The original wording — "each transform boundary" — was both an overstatement and an under-delivery, and both halves are now fixed:

- **Node/browser (`pipeline-shared.ts`): five boundaries.** `resolveSettings`, `computeBreakpoints`, `computeStyles`, `deduplicateStyles`, `computePositions`. `groupArtboards` is deliberately *not* asserted: it partitions existing artboard references into arrays and coins no numbers, so a sixth walk over the same objects has zero coverage value.
- **ExtendScript (`src/extendscript/index.ts`): two boundaries.** Entry (`resolveSettings`) and exit (emitter-ready). Previously **zero** — the claim above was simply false on the Illustrator path, which is the one that actually ships to users and which never runs Zod, so `processAndEmit(doc, { settings: { maxWidth: Infinity } })` emitted `max-width: Infinitypx`. Entry+exit catches every sentinel that is still a *number* at the exit boundary; it just names the boundary rather than the individual transform.

**Correction: "every sentinel that can reach the emitter" was too strong.** The walk tests `typeof === "number"`. `compute-positions.ts:52` divides by `artboard.width` and interpolates the quotient into a string in the same expression, so `artboards[0].width = 0` reaches the emitter as `"Infinity%"` and both gates pass — verified on `golden-ir/countries.json` through `processAndEmit`, which emitted `left:Infinity%` with zero warnings. This is not a regression from the five-boundary version: at no boundary is the value a number. Zod blocks it on the shared path (`ArtboardSchema.width` is `.positive()`), and the ExtendScript path — the unvalidated one, which is the whole reason the guard lives there — now blocks it at input with `assertUsableArtboardDimensions` (`src/core/artboard-dimensions.ts`).

Input validation rather than string-matching in the walk: the document legitimately carries user text, so rejecting strings that look like `"NaN"` or `"Infinity"` would throw on valid artwork (a run reading "NaN", an artboard named "Infinity Pool"). Artboard width/height are the only divisors in the ExtendScript-bound transforms, so the guarded set is the complete class rather than a sample; **a new divisor needs a new input guard, because no purity assertion will cover it.**

**The cost is not negligible, and an earlier note here said otherwise.** The "~0.18 ms" figure was a single small fixture. The walk is O(document), so the relative cost does not shrink with size. Re-measured (median of 20 rounds x 20 reps, transforms only, Zod excluded):

| processed document | transforms | + 5 guards | + 6 guards (old) |
|---|---|---|---|
| 44 KB (`golden-ir/countries.json`) | 0.19 ms | 0.26 ms (+32%) | 0.30 ms (+52%) |
| 168 KB | 0.52 ms | 0.96 ms (+84%) | 1.06 ms (+103%) |
| 419 KB | 1.31 ms | 2.41 ms (+83%) | 2.71 ms (+106%) |

So the guard trends toward ~1x the transform stage it protects. It still runs unconditionally: ~1 ms on a 419 KB document is noise against the file and image I/O around any real export, and a guard that only runs in tests cannot catch what a user's document introduces. But the boundary count is now a decision backed by numbers rather than an assumption — dropping `groupArtboards` alone reclaimed ~20% of the guard cost, and the ExtendScript path takes the two-boundary subset at ~40% of the five-boundary cost.

---

## D22 — A live Illustrator smoke run is a release gate [decided]

The ExtendScript bundle test evaluates through Node's `new Function` while simulating a few missing built-ins. That is weaker than the real deployment constraint: ExtendScript is ES3 plus custom polyfills, so syntax and runtime failures can pass the Node test.

This is not hypothetical — a lint autofix in this very session rewrote `hasOwnProperty` into `Object.hasOwn` (ES2022, absent from ExtendScript and *not* in `polyfills.ts`), and only a tsconfig lib mismatch caught it. Node-based tests would not have.

No cutover ships without a real Illustrator run.

---

## D23 — The semantic tree feeds all four emitters, not just HTML [decided]

Collapsing `html.ts` and `html-string.ts` does not fix Svelte and React: both call the HTML emitter, then **regex-extract the `<style>` block and strip comments** (`src/emitters/react.ts`, `src/emitters/svelte.ts`). They consume serialized HTML, not structure.

So the node tree is the shared input to HTML, React, and Svelte adapters — otherwise the framework emitters stay string-manipulation wrappers no matter how clean the HTML side becomes. This also connects to D8 (Svelte/React are real emitters).

Serializer requirements that must be specified and tested, not discovered: attribute vs text escaping as distinct grammars; boolean attributes (`autoplay`, `muted`, `loop`, `playsinline`); void elements; raw-text handling for `script`/`style`; deterministic attribute order (the string emitter currently depends on object key order); comment sanitization; and **CSS URL escaping, which is a different grammar and must not be delegated to HTML escaping**.

---

## D24 — The ExtendScript core boundary should shrink [decided]

"Every surface loads the core" is too coarse. The bundle currently includes the entire static transform path plus the HTML string emitter. After Effects should not load static artboard transforms merely to reuse settings resolution, warnings, fonts, and bundling.

Split into **envelope services** (settings, fonts, warnings, bundling) and **scene-specific entry points**. This also serves the D17 bundle-size constraint.

---

## D17 — The ES5/ExtendScript budget is a first-class constraint [decided]

Missing from my plan entirely, and it is the constraint most likely to force a mid-flight redesign.

The core ships as an ES5 IIFE into a runtime with no native `JSON`, no `Object.assign`, and known `evalScript` payload limits (the panel already routes settings through a temp file to dodge them). Tagged unions, a definitions-driven generator, structured warning objects, and a node-tree plus serializer all add bundle weight.

Every contract change from here carries a bundle-size check. Record the assembled size before and after.

---

## D10 — QGIS gets no direct plugin [decided]

The dominant newsroom static-map workflow is **QGIS → Illustrator → ai2html**. We already cover it at the Illustrator step. PyQGIS is open and a plugin is feasible, but it would duplicate a path that already works.

---

## D11 — No ai2html migration guide [decided]

Overruled by the product owner. The reasoning: nobody is genuinely fluent in ai2html; new users will be confused about *installation*, not about settings-key mapping. An honest install guide plus a generated "what works where" support matrix is the doc deliverable.

The compat layer itself (32 snake_case keys, the `ai2html-*` block family) stays — it just does not need a dedicated migration page.

---

## D12 — Illustrator stays on CEP/ExtendScript [decided]

UXP for Illustrator remains internal-only as of 2026 with no public API and no announced timeline. Adobe has stated intent to phase out CEP/ExtendScript but has not signalled Illustrator CEP deprecation. CEP + ExtendScript remain the production path.

No migration work. Revisit when a public UXP API ships.

---

## D25 — Capability warnings compare the request against the surface, not against the default [decided]

The first implementation of §12.5 suppressed the warning whenever the resolved value equalled the value in `SETTING_DEFINITIONS`. That establishes nothing: a default is a promise the surface may not keep, and comparing against it inverts the answer in **both** directions wherever a surface diverges at its default.

Figma is the proof. It exports at `scale: 1` (`runtime-extract.ts#createBackgroundAsset`) while `use2xImages` defaults to `true`:

- omitted, or explicitly `true` → no warning, and the user silently gets 1x — the opposite of what they were promised;
- explicitly `false` → a warning, even though 1x is exactly what Figma does.

Same shape for `pngTransparent` (default opaque, always alpha) and `pngNumberOfColors` (default 128, no quantizer). The 30 matrix cases passed only because the test picked non-default values, so the suite structurally could not see it.

**Decision.** A surface declares `divergesAtDefault` — the value it actually behaves as — wherever that differs from the global default, and the checker warns whenever the request is not what the surface will produce. Omitting the field asserts the surface does what the default says.

Two consequences accepted deliberately:

1. **Some settings now warn on more exports, including untouched ones.** Three Figma cells warn on every export. That is correct: the export really is not what the settings say. The noise budget is pinned per surface in `test/unit/capabilities.test.ts`, so adding a standing warning is a reviewed change and not a drift.
2. **A value the surface does produce never warns**, even when the declaration says `unsupported`. `imageFormat: ["png24"]` on Figma is honored in fact — Figma exports full-color alpha PNG — so warning about it would be the same defect in the other direction.

**Corollary — content-dependent gaps warn from the emitter, not the checker.** Some settings are honored for one kind of document content and dead for another, and which case a document hits is a property of the document, which the settings checker cannot see. Such a setting is declared with `warnedByEmitter`: the checker skips it and the emitter that writes the harmful output warns at that call site. Declaring it blanket `unsupported` instead would fire on every export ever made, most of which are not broken.

The worked example was `useLazyLoader` — honored for images (native `loading="lazy"`), dead for video (`data-src`, no `src`, no loader script anywhere). It is now **historical**: `src/emitters/shared/lazy-video.ts` ships the loader on all four formats, so the declaration and the per-layer warning are both gone.

**`warnedByEmitter` therefore currently has no live entry, and stays anyway.** It is a deliberate unused seam, not dead code to be swept: the field, its JSDoc, and the checker's `continue` on it are the written-down form of this corollary. Deleting it would mean the next content-dependent gap gets re-reasoned from scratch under time pressure, and the cheap wrong answer — blanket `unsupported` — is exactly the noise this decision rejects. Do not remove it because a lint or a coverage sweep reports it unreferenced.

---

## D26 — After Effects is declared, not enforced [decided]

`afterEffectsCapabilities` defaulted nearly every setting to `na`, which read as enforcement. Nothing enforced it: the AE exporter never loads the core bundle (`grep -c All2Html plugins/after-effects/exporter.jsx` → 0), so no code path there can call the checker, and an AE config carrying `{"settings":{"imageFormat":["svg"]}}` is ignored in silence.

The options were to run a lightweight AE-local check or to stop claiming AE warns. A second declaration hand-written in AE's ExtendScript would be a forked source of truth of exactly the kind D16 and the no-forked-helpers rule exist to prevent, and it could not be smoke-tested without a live AE session.

**Decision: stop claiming it.** `SurfaceCapabilities.runtimeChecked` makes the claim explicit and machine-checkable; AE is the only `false`. `test/unit/capabilities.test.ts` asserts that AE has no call site and that every other surface does, so neither half of the claim can quietly become untrue. Enforcement for AE arrives with SPEC §12.8 (AE loads the core), not with an edit to the capability table.

---

## D27 — `Artboard.relationship` is removed, not documented [decided]

**Reversal of the round-1 response.** D13 shipped `Artboard.relationship: "alternates" | "sequence"` as "one field" — a modelling gap made explicit without paying for the envelope/scene split. Round 1 flagged it as an accepted-and-ignored field added by the very work whose thesis is eliminating them. The response was to *document* it as "validated but not yet consumed" and to pin round-tripping in `pipeline-phase-types.test.ts`.

That does not satisfy D16, which requires dead code to get **a test pinning its intended caller, or a deletion that names its replacement**. A round-trip test pins neither: it asserts that a value survives transforms that are indifferent to it. There were zero behavioural consumers, and documenting an unused field converts a defect into a commitment.

**Decision: remove it (option a).** Gone from `types.ts`, `schema.ts`, and the public export surface. The removal names its replacement: `groupArtboards`, which is where alternates-vs-sequence has to act, and which cannot take it until it is ES3-safe (D19 — `group-artboards.ts` uses `new Map` twice, and the ExtendScript bundle test forbids that). `types.ts` keeps a tombstone comment saying so, and `pipeline-phase-types.test.ts` now asserts the field is not carried through validation and has no reader anywhere in `src/`.

Removing it cost nothing, because nothing read it. Adding it back is cheap the day `groupArtboards` can consume it, and it must arrive with that consumer — not before, and not as a type-level thread.

**Reverses if:** `groupArtboards` becomes ES3-safe and grouped output is wired onto the distinction. The field returns then, with the consumer, in the same change.

---

## D28 — An `exportParams` record is a capability claim [decided]

The Figma runtime stamped `{format:"png", scale:1, transparent:false}` on every extracted asset while `figmaCapabilities` declared that Figma behaves as `png24`, transparent, 1x. Both could not be right, and the asset record was the wrong one: Figma's `ExportSettingsImage` (`@figma/plugin-typings`) carries no bit-depth, palette, or matte option, and no `constraint` is passed anywhere in `runtime-extract.ts`, so `exportAsync({format:"PNG"})` produces full-color PNG with alpha at the documented default scale of 1.

This is the same defect the capability matrix cites as its own D1 evidence on Illustrator — `exportParams.format` recording `svg` over PNG8 bytes. The declaration had been added beside the record it contradicted without reconciling it.

**Decision.** `exportParams` is not decoration: it is the only machine-readable statement of what a downstream consumer actually received, so it is part of the capability claim and is reviewed as one. Figma now records `png24` / `scale: 1` / `transparent: true` from one shared constant (`FIGMA_EXPORT_PARAMS`), covering the background raster and both special-layer export paths, and the file extension is no longer used as the format (a `.png` file holding png24 bytes). `test/unit/figma-runtime.test.ts` asserts the constant, the assets built from it, and `figmaCapabilities` agree on all three facts, so the record and the declaration cannot drift apart again.

**Corollary:** adding a capability declaration means checking the artifacts the surface already writes about itself, not only the code that produces them.

---

## D29 — Bundle budgets cover the shipped artifact, and drift is reported, not merely permitted [decided]

D17 made the ES5 budget a first-class constraint. Two holes showed up in practice.

**1. The ratchet had gone cosmetic.** The baseline recorded 109,260 B while the built bundle was 113,012 B: +3,752 B, 69% of the 5% tolerance, with no history entry. The file's note claimed growth "stays visible in git history," but only *re-records* are visible; sub-tolerance growth is invisible by design, which is exactly how three quarters of the allowance was spent without anyone deciding to spend it. The test now prints the delta and labels any nonzero growth **UNATTRIBUTED DRIFT**, with the share of tolerance consumed, and it fails if the last `history` entry does not match the recorded `bytes` — so a re-record cannot land without an attribution.

**2. The artifact users install had no budget at all.** Only the intermediate `dist/extendscript/all2html-core.js` was guarded. `dist/all2html.js` — json2 + core + `exporter.jsx`, ~45% of it outside the guarded core — could grow without limit. It now has its own baseline, tolerance, and history.

**Reconciliation of the 3,752 B**, measured as rollup `renderedLength`: +2,111 B `core/json-purity.ts` (D21, now covering the ExtendScript path), +458 B `emitters/shared/lazy-video.ts` (D31), residual ~1,183 B for the `divergesAtDefault` comparison and the widened declarations (D25). All attributed rather than reclaimed — each one is a fix users can observe.

**And the reclaim the file itself named:** the `help` prose in `SETTING_DEFINITIONS` moved to `src/ir/setting-help.ts`. `SETTING_DEFINITIONS` is imported by `schema.ts`, `defaults.ts` and `core/capabilities.ts`, so it reaches the ExtendScript bundle, and rollup cannot tree-shake properties out of object literals nested in an array literal — every byte of panel-only copy shipped into Illustrator. Only the CEP panel and `scripts/generate-settings-docs.ts` read it, and neither is in the ExtendScript entry graph. Worth 8,706 B, not the ~11.8 KB estimated from source bytes. Core is re-recorded at 104,306 B, below where it stood before this round's spending, and a test asserts the bundle contains no help copy so it cannot creep back.
