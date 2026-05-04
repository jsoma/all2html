# Illustrator Manual QA Checklist

Supported manual QA matrix for the CEP-first Illustrator workflow.

## Supported Floor

- CEP support target: Illustrator 2019+ (`ILST 23.0+`)
- Older script-only installs are not part of the supported matrix

## Lanes

Run these checks on:

- macOS current
- macOS 2019
- Windows current
- Windows 2019

## Current Status

- 2026-04-07: macOS current export automation completed for the release-blocking fixtures plus `hyperlinks`, `accessibility`, `layer-export-matrix`, `video-editorial`, `html-hooks-editorial`, and `large-story` via `scripts/export-illustrator-fixtures.ts --golden`
- macOS current CEP install/update and visual panel interaction checks: pending manual run
- macOS 2019: pending local Illustrator 2019 environment
- Windows current / Windows 2019: pending real Windows Illustrator environment

## CEP Install / Update

1. Install the latest `.zxp` on a clean machine.
2. Confirm the panel appears under `Window > Extensions`.
3. Update from an older installed panel using a newer `.zxp`.
4. Confirm the update replaces the prior install cleanly.
5. Uninstall the panel and verify Illustrator no longer lists it.
6. Repeat installation with the `.zip` fallback by replacing the CEP extension folder manually.

## Release-Blocking Fixtures

These fixtures must be exercised manually in the panel:

- `multiple-files-test`
- `layer-types-test`
- `mask-test`
- `settings-precedence`
- `layer-export-matrix`

## Non-Release-Blocking Real Fixtures

Exercise these as time allows during manual QA so the fixture corpus stays grounded in the CEP-first workflow:

- `hyperlinks`
- `accessibility`
- `video-editorial`
- `html-hooks-editorial`
- `large-story`

## Export Checks

For each release-blocking fixture:

1. Open the document in Illustrator.
2. Launch the CEP panel.
3. Confirm the panel detects the document and current settings.
4. Change the document after opening it and confirm the panel still treats it as the same saved file rather than resetting to an unsaved state.
5. Run export from the panel.
6. Confirm the output directory contains HTML, `ir.json`, and expected assets.
7. Re-open the exported HTML and confirm the layout renders correctly.
8. Click `Open folder` and confirm Finder/Explorer opens the exported directory.

If export fails or the panel state looks wrong, capture diagnostics from the shell before falling back to screenshots:

```bash
pnpm diagnostics:illustrator
```

These checks do not require a human to click through Illustrator. On macOS, use AppleScript/System Events to open fixtures and show `Window > Extensions > all2html`, then use the CEP debug endpoint from `CLAUDE.md` (`localhost:8870`) to reload the panel, inspect controls, trigger button clicks, and verify panel text/output. This is the preferred smoke path when validating panel UI changes locally.

## Settings Precedence Verification

Use `settings-precedence` with its sibling `all2html.config.json`.

1. Confirm the panel shows document-controlled locks for keys coming from the `ai2html-settings` block.
2. Confirm text-block settings win over config-file values.
3. Change an unlocked panel value that is also present in config.
4. Run export and confirm panel edits beat config for unlocked keys.
5. Confirm locked keys are not persisted back into XMP/app defaults as editable panel state.

## Fixture-Specific Checks

### `multiple-files-test`

- Confirm grouped files export separately.
- Confirm each HTML file contains only its own group content.

### `layer-types-test`

- Confirm SVG/PNG/symbol/video/html-hook content renders in the exported HTML.
- Confirm the background image excludes special layers that are exported separately.

### `mask-test`

- Confirm hidden or clipped content does not leak into the final HTML unexpectedly.
- Confirm visible masked text remains positioned and readable.

### `hyperlinks`

- Confirm the exported HTML wraps the artboard in a real anchor using the configured `clickable_link`.
- Confirm visible text remains HTML, not image-only fallback.

### `accessibility`

- Confirm the exported container gets the configured `role`.
- Confirm the hidden accessibility text block is present and referenced by `aria-describedby`.

### `layer-export-matrix`

- Confirm the exported HTML contains one inline `<svg>` block.
- Confirm the exported HTML references one external `.svg` asset and one PNG overlay asset.
- Confirm the background image does not visually absorb the special export layers.

### `video-editorial`

- Confirm the exported HTML contains exactly one `<video>` element using the valid HTTPS `.mp4` URL.
- Confirm the invalid `.mov`, non-HTTPS, and blank `:video` layers do not emit video markup.
- Confirm the export reports warnings for the invalid video layers.

### `html-hooks-editorial`

- Confirm valid `ai2html-html-before` and `:html-before` content renders before the main graphic copy.
- Confirm valid `:html-after` and `ai2html-html-after` content renders after the main graphic copy.
- Confirm the hidden special block and blank hook layer do not render.
- Confirm the export reports warnings for the skipped invalid hook content.

### `large-story`

- Confirm all six artboards export successfully.
- Confirm grouped assets are present for both the SVG locator layer and the PNG highlight layer.
- Confirm export time and asset writing feel reasonable for a larger editorial package.

## Windows Notes

- Real Windows validation is still required for the CEP panel `Open folder` path even though the panel now has explicit Windows unit coverage.
- Do not treat macOS CEP success as proof that Windows host behavior is correct.
