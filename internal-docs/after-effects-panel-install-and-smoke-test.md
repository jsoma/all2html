# After Effects Panel Install And Smoke Test

Install and first-pass QA guide for the shared `all2html` CEP panel in After Effects.

## Supported Floor

- After Effects 2019+ (`AEFT 16.0+`)
- Host coverage comes from the CEP manifest in `plugins/illustrator/panel/dist/cep/CSXS/manifest.xml`

## Build Artifacts

From the repo root:

```bash
pnpm package:panel:zip
```

This writes:

- `plugins/illustrator/panel/dist/zxp/com.all2html.panel.zxp`
- `plugins/illustrator/panel/dist/zip/all2html_0.1.0.zip`
- `plugins/illustrator/panel/dist/cep/`

## Install

Use one of these paths:

1. Install `com.all2html.panel.zxp` with a CEP extension manager.
2. Or manually copy `plugins/illustrator/panel/dist/cep/` to the CEP extensions folder as `com.all2html.panel`.

Manual install folders:

- macOS: `~/Library/Application Support/Adobe/CEP/extensions/com.all2html.panel`
- Windows: `%APPDATA%\Adobe\CEP\extensions\com.all2html.panel`

After install:

1. Restart After Effects.
2. Open the panel from `Window > Extensions > all2html`.

If After Effects hides unsigned CEP extensions on the test machine, enable CEP debug mode for `CSXS.9` before retrying the launch.

## Smoke Test Fixture

Use a saved `.aep` with:

- at least one composition
- at least one text layer named with the `overlay:` prefix
- any non-overlay media/background layers needed for video render

Fonts and third-party AE plugins used by the project must already be installed on the exporting machine.

## Smoke Test Steps

1. Open the saved `.aep` in After Effects.
2. Launch `all2html` from `Window > Extensions`.
3. Confirm the panel shows the project name and selected comp.
4. Change the comp selection and confirm the comp summary updates.
5. Confirm output-module templates load in the Video and Poster selectors.
6. Open Font Mapper, detect missing fonts, and add one mapping.
7. Leave `Output Root` blank for the default path, or set a relative override such as `exports/ae`.
8. Run export.
9. Click `Open folder`.

If export fails or panel state looks wrong, read host diagnostics from the shell before falling back to screenshots:

```bash
pnpm diagnostics:after-effects
```

## Expected Output

For a comp named `My Comp`, expect output under either:

- `<project-folder>/all2html-ae-output/my-comp/`
- or the selected output root override

Expected files:

- `my-comp.html`
- `my-comp.json`
- `my-comp-summary.json`
- `my-comp.mp4` when rendered locally, or an AME queue job if AE falls back to Media Encoder
- optional `my-comp-poster.*`

## Panel Checks

Confirm these behaviors during the smoke run:

1. `Overlay Prefix`, `Output Root`, and template selectors persist to `all2html-ae.config.json` next to the `.aep`.
2. `Save as Default` stores app defaults and they appear when a project has no local override.
3. The success summary reports:
   - comp name
   - render mode (`render-queue` vs `ame`)
   - selected video template when one is used
   - poster status
   - output, summary, HTML, JSON, and video paths
4. A bad explicit template selection fails clearly instead of silently falling back.
5. Failed exports or bad template selections surface diagnostics in-panel, not just a generic error.
6. `Open folder` works from the CEP panel after a successful export.
7. **New since the exporter got the bundle slot (D13):** `all2html-ae.jsx` now concatenates
   `dist/extendscript/all2html-ae-core.js` ahead of `exporter.jsx`, and that bundle installs the
   ES5 polyfills and owns the escaping and Google Fonts helpers. Nothing in the repo can prove it
   evaluates inside ExtendScript's ES3 engine, so the host run has to:
   - export once with `googleFonts: "link"` and once with `"import"`, and confirm the exported HTML
     carries the three `<link>` tags / the `@import url(...)` rule with a real fonts.googleapis.com
     URL. An empty result means `All2HtmlAE` did not load or the ES5 lowering broke.
   - export a comp with an `overlay:` layer whose text contains `</script>` and a `$&`, and confirm
     the player renders it rather than breaking out of the inline `<script>`.
   - confirm no `[all2html-ae] The all2html core helper bundle is missing` error, which is what a
     mis-ordered or missing concatenation now produces instead of a silent `ReferenceError`.
   `pnpm diagnostics:after-effects` is the documented probe if any of these fail.

   **Run 2026-07-27, After Effects 2026 (host build 33415), and what it settled.** The bundle was
   evaluated in the real ES3 engine via `DoScriptFile` and every helper exercised directly:

   | Check | Result |
   |---|---|
   | `$.evalFile(all2html-ae-core.js)` → `typeof All2HtmlAE` | `object` — it loads |
   | The five exports are callable | all `function` |
   | Polyfills installed by the bundle (`map`, `indexOf`, `trim`, `Number.isNaN`) | all `function` |
   | `googleFontsUrl([{sourceFont,family:"Roboto",weight:"700"}])` | `https://fonts.googleapis.com/css2?family=Roboto:wght@700&display=swap` |
   | `googleFontsLinkTags(...)` | 3 tags, first `rel=preconnect` |
   | `escapeInlineJson` on `<!--<script>alert(1)</script>` | no raw `<` survives; every one is `<` |
   | `escapeAttr` / `escapeHtml` | correct per grammar |
   | `new Function(all2html-ae.jsx)` — the assembled 79,337-byte artifact | parses |

   That closes the "does it evaluate / did ES5 lowering break" question, which is the part no repo
   test can reach, and confirms the inline-JSON `<` fix in the host rather than only in jsdom.

   **Still not done here:** a full comp export producing a rendered video plus a playable page. That
   exercises the render queue and output modules rather than the bundle slot, and needs a real
   project file. Do it before any AE release; the escaping bullet above is already covered both in
   the host (table) and by the jsdom test that parses the real player template with the payload.

## Current Gaps

- No batch export
- No responsive variants
- No dedicated folder picker UI for `Output Root`
- No automated host-app smoke test yet; this checklist is the release gate for AE panel QA
- Windows CEP panel behavior still requires real host validation even though the panel-side folder-open path now has unit coverage
