# AE Temporal Overlay Prototype

This is an isolated prototype for proving an AE-to-web temporal overlay workflow.

It does **not** touch the main `all2html` IR or emitters. It is a separate exploratory slice under `temp/`.

## What It Proves

- Export one active After Effects comp
- Render one video asset for that comp
- Export sampled text-overlay metadata in a NYT-like runtime format
- Generate one standalone HTML player that overlays animated text on top of the video
- Keep the text separate from the rendered media

This prototype intentionally does **not** solve:

- scroll-linked playback
- sticky scrollytelling layout
- desktop/mobile variants
- shape or SVG overlays
- semantic support for AE text animators/selectors/expressions
- integration with the main `all2html` pipeline

## Authoring Contract

The active comp is the only export unit.

Overlay layers must satisfy all of these:

- they are AE text layers
- they are visible and enabled
- their names start with `overlay:`

Everything else is treated as normal comp content and gets baked into the rendered video.

Timing rules:

- overlay timing comes from each layer's `inPoint` and `outPoint`
- `start` and `end` in the exported JSON are **inclusive frame numbers**
- sampled arrays are written frame-by-frame inside that active window

Animation rules:

- this prototype samples evaluated transform values frame-by-frame
- supported sampled properties are:
  - `pos`
  - `opacity`
- exported static properties are:
  - `anchor`
  - `scale`
  - `rot`
- if AE animates scale, rotation, source text, or text style, this prototype does not preserve those semantics; it only captures the sampled fields it knows about

## Output Files

Running the script writes files to:

`temp/ae-prototype/<slug>/`

Expected outputs:

- `<slug>.mp4`
- `<slug>-poster.png` when AE has a usable still-image output template
- `<slug>.json`
- `<slug>.html`

Where `<slug>` is derived from the active comp name.

## JSON Format

The JSON is a runtime-oriented sampled format modeled after the NYT tracking files.

Top-level shape:

```json
{
  "stage": {
    "width": 1920,
    "height": 1080,
    "frameRate": 30,
    "frameLength": 720
  },
  "media": {
    "kind": "video",
    "src": "./example.mp4",
    "poster": "./example-poster.png",
    "posterFrame": 108
  },
  "layers": {
    "overlay-title|12": {
      "start": 30,
      "end": 120,
      "type": "text",
      "text": {
        "content": "Example label",
        "altText": "Example label",
        "style": {
          "fontFamily": "Arial",
          "fontSize": 42,
          "fontWeight": "700",
          "fontStyle": "normal",
          "color": "rgb(255,255,255)",
          "textAlign": "left"
        }
      },
      "static": {
        "anchor": [0.5, 0.5],
        "scale": [1, 1],
        "rot": 0
      },
      "animatedTransforms": ["pos", "opacity"],
      "pos": [[0.42, 0.39], [0.421, 0.391]],
      "opacity": [0, 0.25, 0.5, 1]
    }
  }
}
```

Conventions:

- `pos` is normalized to comp width/height
- `anchor` is normalized against the text bounds at the layer's first active frame
- `opacity` is normalized to `0..1`
- `scale` is exported as `1 = 100%`
- text is exported as a flat string
- `posterFrame` defaults to roughly 15% into the comp, clamped to a valid frame
- no `animatedAttributes` support in v1

## Running The Exporter

1. Open the AE project.
2. Make the target comp active.
3. Ensure overlay text layers use the `overlay:` prefix.
4. Run:

   `temp/ae-prototype/export-ae-temporal.jsx`

The script will:

- render one poster frame from the overlay-free comp when a PNG/JPEG sequence template is available
- sample overlay metadata
- write JSON
- generate the HTML player
- attempt to render an MP4

## Video Render Notes

MP4 automation in AE is awkward and template-dependent.

The script uses this strategy:

1. Try to find a local H.264-style output-module template and render directly in AE.
2. If that is not available and AE can queue to AME, send the queued item to AME.
3. If neither works, stop with a clear error.

Because output-module templates vary by installation, this prototype assumes one of the common H.264 templates exists locally. If it does not, the script falls back to AME when possible.

This is a prototype limitation, not a final product decision.

For ExtendScript compatibility, the exporter will also load the existing Illustrator-side `plugins/illustrator/json2.js` polyfill if the local AE runtime does not expose `JSON.stringify`.

## HTML Player Behavior

The generated HTML:

- uses plain JavaScript
- renders a responsive `<video>`
- overlays one absolutely positioned text node per exported layer
- computes `currentFrame = floor(currentTime * frameRate)`
- applies sampled `pos` and `opacity` using the current frame
- uses `requestAnimationFrame` while the video is playing
- updates on `loadedmetadata`, `timeupdate`, and `seeked`

The HTML embeds an inline copy of the JSON so it works from disk, but the sidecar JSON is also written next to it for inspection and future tooling.

## Validation

The exporter and player both validate:

- `frameRate > 0`
- `frameLength > 0`
- `start <= end`
- sampled array length equals `end - start + 1`
- `pos` samples are 2-tuples
- `opacity` samples are numeric
- `media.src` is present

## Known Limitations

- one active comp only
- no batch export
- no responsive variants
- no precomp traversal
- no markers
- no shape/SVG overlays
- no scroll controller
- no easing model
- no sparse keyframe model
- no semantic support for AE text animators beyond sampled evaluated values

## Success Criteria

The prototype is successful if:

- the script produces MP4 + JSON + HTML for one active comp
- the HTML plays the video
- the overlaid text moves and fades over time
- seek/scrub stays aligned with the sampled data
- the workflow is simple enough to judge whether an AE-driven temporal system is feasible

## Next Questions

If this works, the next decisions are:

- whether to add scroll as just another playback controller
- whether to keep a sampled runtime format or introduce a sparse authoring format
- whether a future temporal model should become part of `all2html` proper
