# Illustrator Hardening Matrix

This document scopes the next Illustrator hardening phase for the CEP panel and ExtendScript exporter.

## Recommendation

- **Support floor:** Illustrator 2019+ (`ILST 23.0+`)
- **Why:** the CEP panel manifest already targets `[23.0,99.9]`, so 2019 is the natural compatibility boundary for the primary UX.
- **Do not raise the floor to 2020+ or 2022+ yet:** there is no clear feature breakpoint in the current codebase that justifies dropping 2019. The bigger risk is missing real-document coverage, not missing runtime APIs.

## Version Matrix

Use two lanes:

| Lane | OS | Illustrator | Purpose | Release-blocking |
|---|---|---:|---|---|
| Current | macOS | latest supported | primary dev and packaging lane | yes |
| Current | Windows | latest supported | primary user install/update lane | yes |
| Floor | macOS | 2019 | CEP/runtime compatibility floor | yes |
| Floor | Windows | 2019 | CEP/runtime compatibility floor | yes |
| Midpoint | macOS or Windows | 2022 | optional drift check only if available | no |

If the matrix gets too expensive, drop the midpoint first, not the floor.

## What Is Covered Today

The repo currently has:

- 20 real Illustrator source files in `data/`
- 20 golden IR fixtures from real Illustrator exports in `test/fixtures/golden-ir/`
- a tracked real-fixture registry in `test/fixtures/illustrator-fixtures.ts`
- a macOS Illustrator export harness for generating and auditing saved outputs

The synthetic IR suite is still broader than the real Illustrator corpus, but the main Illustrator v1 contracts now have dedicated real-fixture coverage instead of only synthetic IR smoke tests.

## Real Illustrator Corpus

| Source file | Main scenario(s) covered | Golden IR fixture | Saved generated output | Gaps / notes | Priority |
|---|---|---|---|---|---|
| `data/sample-ai-file.ai` | basic single-artboard export, metadata, text + image | yes | yes | good smoke fixture; not stressful | P2 |
| `data/fixed.ai` | fixed responsiveness, multi-artboard fixed layout | yes | yes | good baseline for fixed layout | P1 |
| `data/template.ai` | template-style multi-artboard responsive output | yes | yes | good responsive baseline | P1 |
| `data/countries.ai` | richer editorial doc, SVG interaction layers, custom HTML, multiple assets | yes | yes | strongest “real story graphic” fixture today | P1 |
| `data/text-cleanup.ai` | text cleanup / custom CSS block behavior | yes | yes | useful text fidelity fixture, but narrow | P2 |
| `data/multiple-files-test.ai` | one-file vs multiple-files grouping | yes | yes | release-blocking regression fixture | P0 |
| `data/layer-types-test.ai` | special layer coverage (PNG, symbol, video, html hooks) | yes | yes | release-blocking regression fixture | P0 |
| `data/mask-test.ai` | clipping/mask coverage | yes | yes | release-blocking regression fixture | P0 |
| `data/settings-precedence/settings-precedence.ai` | `text block > panel > config` precedence | yes | yes | release-blocking regression fixture | P0 |
| `data/hyperlinks/hyperlinks.ai` | whole-graphic `clickableLink` contract | yes | yes | proves real Illustrator link wrapping path | P1 |
| `data/accessibility/accessibility.ai` | `altText` / `ariaRole` metadata path | yes | yes | proves typed metadata survives export | P1 |
| `data/layer-export-matrix/layer-export-matrix.ai` | external SVG asset vs inline SVG vs PNG overlay | yes | yes | focused layer-export parity fixture; release-blocking | P0 |
| `data/video-editorial/video-editorial.ai` | editorial video layer with valid + invalid URL handling | yes | yes | explicit warning-path fixture for `:video` | P1 |
| `data/html-hooks-editorial/html-hooks-editorial.ai` | editorial html-before/html-after layers + special blocks with invalid cases | yes | yes | focused hook-order + warning fixture | P1 |
| `data/large-story/large-story.ai` | multi-artboard editorial export/performance smoke | yes | yes | stresses output scale and asset writing | P1 |
| `data/rotated-text-real/rotated-text-real.ai` | rotated text stays HTML | yes | yes | focused text fidelity fixture | P1 |
| `data/rotated-text-image/rotated-text-image.ai` | rotated text rasterizes on demand | yes | yes | exercises render boundary | P1 |
| `data/character-styles-real/character-styles-real.ai` | rich inline character styles | yes | yes | single-frame style coverage | P1 |
| `data/font-mapping-real/font-mapping-real.ai` | font mapping / missing fonts | yes | yes | real document for panel/export font path | P1 |
| `data/overset-text-real/overset-text-real.ai` | overset text warning behavior | yes | yes | warning-path regression fixture | P1 |

## Synthetic IR Coverage (Core, Not Illustrator-Specific)

These areas already have renderer/pipeline coverage in `test/fixtures/ir/`, but do **not** yet have enough real `.ai` exporter coverage:

| Scenario | Synthetic IR fixture exists | Real `.ai` fixture exists | Notes |
|---|---|---|---|
| clickable link | yes | yes | dedicated `hyperlinks.ai` proves the real Illustrator boundary |
| alt text / accessibility | yes | yes | dedicated `accessibility.ai` proves typed metadata survives export |
| SVG inline layer | yes | yes | dedicated `layer-export-matrix.ai` covers focused inline SVG output |
| PNG overlay layer | yes | yes | dedicated `layer-export-matrix.ai` covers focused overlay output |
| video layer | yes | yes | dedicated `video-editorial.ai` covers valid + invalid URL handling |
| `:html-before` / `:html-after` | yes via custom blocks/layer fixtures | yes | dedicated `html-hooks-editorial.ai` locks ordering and warning behavior |
| symbol / div layers | yes | partial | still covered through `layer-types-test.ai`, not a focused dedicated fixture |
| tagged text binding markers | yes | no | deferred feature; not a hardening priority for Illustrator v1 |
| character styles / rich inline text | yes | yes | `character-styles-real.ai` is the focused fixture |
| rotated text | yes | yes | covered by `rotated-text-real.ai` and `rotated-text-image.ai` |
| point text overflow / overset text | yes | yes | `overset-text-real.ai` covers the warning path |
| font mapping | yes | yes | `font-mapping-real.ai` covers the real document path |
| multiple-files output | yes | yes | release-blocking real fixture with golden IR |

## Missing Scenarios

These are the remaining under-covered Illustrator scenarios after the current editorial/video/hooks pass.

### Remaining Gaps
The remaining work is now mostly manual QA depth and future scope:

- Windows CEP install/update validation on real Illustrator installs
- macOS 2019 floor validation on a real Illustrator 2019 install
- deciding whether newer P1 fixtures should become release-blocking after another human QA rerun
- broader stress/performance docs once `large-story.ai` has been exercised repeatedly

### P1: Next Real-World Fidelity Targets

| Scenario | Why it matters | Current status |
|---|---|---|
| rotated text that stays text | known drift area | covered by `rotated-text-real.ai` |
| rotated/skewed text that must rasterize | exporter decision boundary | covered by `rotated-text-image.ai` |
| rich inline character styles in one frame | body/headline/mixed span fidelity | covered by `character-styles-real.ai` |
| hyperlinks extracted from text | newsroom/common workflow | covered by `hyperlinks.ai`; keep non-release-blocking for now |
| alt text / accessibility metadata | downstream accessibility contract | covered by `accessibility.ai`; keep non-release-blocking for now |
| explicit SVG inline vs SVG asset vs PNG overlay | layer export matrix | covered by `layer-export-matrix.ai`; now release-blocking |
| editorial video embed with invalid URL warnings | explicit feature + warning contract | covered by `video-editorial.ai`; evaluate for promotion after next human QA rerun |
| editorial before/after hooks with skipped invalid content | advanced embed workflow | covered by `html-hooks-editorial.ai`; evaluate for promotion after next human QA rerun |
| larger multi-artboard editorial export | export scale / timing confidence | covered by `large-story.ai`; keep as performance/smoke fixture |
| overset/overflow text warning behavior | correctness + UX | covered by `overset-text-real.ai` |
| font mapping and missing fonts | likely real user pain | covered by `font-mapping-real.ai` |

### P2: Nice-to-Have or Broader Regression Coverage

| Scenario | Why it matters | Proposed fixture |
|---|---|---|
| artboard exclusion / naming annotations | exporter settings fidelity | `artboard-settings.ai` |
| symbol / div focused parity fixture | special layer coverage is still bundled in `layer-types-test.ai` | dedicated fixture if regressions appear |
| image-only artboard | simple baseline for non-text exports | `image-only.ai` |
| Windows path edge cases | file path escaping and config resolution | QA checklist, not fixture-only |

## Hardening Checklist

For each real Illustrator fixture that matters, aim to have all of these:

| Artifact | Purpose |
|---|---|
| `.ai` source in `data/` | real extraction input |
| saved export output under `data/all2html-output/<name>/` | inspect real emitted assets/HTML |
| golden IR in `test/fixtures/golden-ir/<name>.json` | lock extraction contract |
| pipeline/integration test coverage | lock core render contract |
| visual screenshot baseline if layout-sensitive | catch CSS/render regressions |

If a fixture only has one or two of these, it is not yet a strong regression asset.

## Recommended Order

1. Complete the remaining manual QA lanes: macOS 2019, Windows current, Windows 2019.
2. Rerun the full human CEP checklist now that `video-editorial`, `html-hooks-editorial`, `large-story`, and the new provenance UX have landed.
3. Decide whether `hyperlinks`, `accessibility`, or the new editorial fixtures should be promoted after that rerun.
4. Add focused symbol/div fixtures only if `layer-types-test.ai` stops being sufficient.

## QA Notes

- The automated Illustrator harness in `scripts/test-illustrator.sh` is macOS-only and validates export success, not UI behavior.
- The tracked fixture export flow is `scripts/generate-illustrator-hardening-fixtures.ts` for scripted `.ai` creation, `scripts/export-illustrator-fixtures.ts --golden` for saved output + golden IR refresh, and `pnpm check:illustrator-fixtures` for artifact completeness.
- The CEP panel is the primary Illustrator UX, so release readiness should require manual panel QA, not just script export success.
- The panel manifest in `plugins/illustrator/panel/cep.config.ts` already defines the supported host range. Any broader support claim in docs should be treated as stale until tested.
