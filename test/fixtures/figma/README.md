# Figma Fixtures

These fixtures represent the first Figma v1 support corpus. Each file captures either:

- extracted frame payloads that already look like canonical Figma plugin output, or
- Figma text segment payloads used to assert warning behavior.

Live fixture source file:

- `all2html figma support fixtures`
- https://www.figma.com/design/9CCiLrpJrr5IdXCGQSObDB
- page: `support-fixtures`

Current coverage:

- `single-frame.json`: basic single-frame export
- `responsive-group.json`: responsive group with distinct widths
- `hyperlink-text.json`: supported URL hyperlink extraction
- `image-only.json`: image-only frame with no text overlays
- `nested-frame.json`: moderate nested/auto-layout-style text positioning case
- `unsupported-node-link-segments.json`: unsupported Figma node hyperlink that must warn clearly
- `news-story-single.json`: realistic single-frame newsroom export with linked deck copy
- `news-story-responsive.json`: 3-width newsroom responsive group for HTML/standalone parity
- `news-story-nested.json`: realistic newsroom layout with nested/auto-layout-style text positioning
- `news-story-mixed-warning.json`: realistic newsroom frame whose output remains valid around a warned unsupported link
- `news-story-mixed-warning-segments.json`: the node-hyperlink text segment that should produce the mixed-warning warning
- `news-special-visual.json`: newsroom frame with `:png`, `:svg`, and `:svg:inline` layers
- `news-special-hooks.json`: editorial frame with `:html-before` and `:html-after` layers
- `news-special-video.json`: editorial frame with a valid `:video` layer
- `news-special-mixed.json`: responsive newsroom pair combining hooks and `:png` overlays
