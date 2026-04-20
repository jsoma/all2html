# Figma Support Gate

Figma remains **beta/internal** until this gate is satisfied. The current goal is not “the plugin runs,” it is “a newsroom designer can use it on normal files without engineering help.”

## Live Fixture Source

- file: `all2html figma support fixtures`
- url: https://www.figma.com/design/9CCiLrpJrr5IdXCGQSObDB
- pages:
  - `support-fixtures`
  - `support-special-layers`

Current live newsroom fixtures:

- `news-story-single`
- `news-story-responsive:640`, `news-story-responsive:960`, `news-story-responsive:1280`
- `news-story-nested`
- `news-story-mixed-warning`

Current live special-layer fixtures:

- `news-special-visual`
- `news-special-hooks`
- `news-special-video`
- `news-special-mixed:640`, `news-special-mixed:960`

## Must Pass Before We Claim Support

- Common newsroom files export successfully through the plugin UI without JSONC.
- `HTML` and `Standalone HTML` both work for the realistic newsroom story set.
- `HTML` and `Standalone HTML` both work for the special-layer newsroom set.
- Single-frame and responsive-group exports are both stable.
- Warning cases are explicit and trustworthy.
- Nested newsroom-style structure does not produce broken positions, `NaN`, or obviously drifted output.
- Special layers do not get baked into the background export or duplicated into default text output.
- Export summaries and warnings are understandable without live engineering help.

## What Now Passes in Repo Coverage

- Atomic Figma fixtures for:
  - single-frame
  - responsive-group
  - hyperlink text
  - image-only frame
  - nested frame
  - unsupported node-link warning
- Realistic newsroom fixtures for:
  - single-frame export
  - responsive 3-width export
  - nested newsroom layout
  - mixed-warning newsroom export
- Realistic special-layer fixtures for:
  - png/svg/svg:inline overlay export
  - html-before/html-after hook ordering
  - valid video export
  - responsive mixed special-layer export
- `HTML` + `Standalone HTML` regression checks for the newsroom fixture set
- Explicit warning assertion for the mixed-warning node hyperlink case
- Explicit warning assertions for hidden/empty hook content and invalid video URLs

## Still Needed Before Support Claim

- Repeated live manual export pass from the dedicated Figma file
- Confirmation that warning wording and export summary copy feel clear to non-technical users
- Preview sanity check for all newsroom fixtures in both output modes
- More real newsroom examples if the current set misses common patterns

## Out of Scope for Figma v1

- Variables
- Custom attributes
- Component-heavy design systems
- Svelte/React output from the plugin UI
- Full-page auto-discovery
- Visual baselines from repeated live Figma exports
