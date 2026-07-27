# Proposal: Temporal Media + Overlay Annotations

## Summary

This document proposes a path for adding a new class of output to `all2html`: temporal media with timed overlay annotations.

The immediate motivation is the New York Times pattern visible in the saved examples:

- [temp/bars.html](/Users/soma/Development/all2html/temp/bars.html)
- [temp/tulsa.html](/Users/soma/Development/all2html/temp/tulsa.html)

Those examples use a `g-scrollingparty` block that is not just a normal `ai2html` artboard. It appears to combine:

- rendered media, usually video or a frame-based animation
- text annotations that appear, disappear, and sometimes move over time
- a playback controller, often scroll-linked but not necessarily limited to scroll
- optional external tracking JSON that drives overlay state

The key question is not "How do we support After Effects files directly?" The key question is:

> What data model should `all2html` use for temporal media with overlays?

This proposal argues for:

1. adding a new temporal branch to the project model
2. keeping shared primitives with the existing static/responsive IR
3. using a sparse authoring model
4. optionally compiling that sparse model to a NYT-style sampled runtime format

## What We Observed In The NYT Files

### 1. `scrollingparty` is a first-class story block

In [temp/bars.html](/Users/soma/Development/all2html/temp/bars.html), the story body includes a serialized `scrollingparty` object, not just a blob of positioned HTML. The object includes:

- `frameRate`
- `frameLength`
- `scrollStart`
- `scrollEnd`
- `videoRenditions`
- `tracking-desktop`
- `tracking-mobile`
- `slides[]`

The object appears in the page data around [temp/bars.html](/Users/soma/Development/all2html/temp/bars.html#L715).

The rendered DOM shell for the same block contains:

- `g-scrollingparty-container`
- `g-scrollingparty-fallback`
- `g-scrollingparty-annotations`

You can see that at [temp/bars.html](/Users/soma/Development/all2html/temp/bars.html#L86).

### 2. The Tulsa example uses the same conceptual pattern

The older Tulsa page has the same structural shell, for example at:

- [temp/tulsa.html](/Users/soma/Development/all2html/temp/tulsa.html#L194)
- [temp/tulsa.html](/Users/soma/Development/all2html/temp/tulsa.html#L484)

That suggests `scrollingparty` is a reusable NYT component family, not a one-off.

### 3. NYT stores runtime tracking data in external JSON

The bars page references:

- `tracking-desktop.json`
- `tracking-mobile.json`

Those URLs point to a runtime format with this high-level shape:

```json
{
  "stage": {
    "width": 1920,
    "height": 1080,
    "frameRate": 30,
    "frameLength": 720,
    "clips": []
  },
  "layers": { ... }
}
```

The Tulsa chapter JSON has the same top-level structure:

```json
{
  "stage": {
    "width": 1600,
    "height": 900,
    "frameRate": 30,
    "frameLength": 620
  },
  "layers": { ... }
}
```

### 4. NYT's runtime format can express both fixed and moving overlays

The bars tracking JSON contains named text layers like:

- `text_pull|...`
- `text_halfturn|...`
- `text_release|...`

Those layers have:

- `start`
- `end`
- `type`
- `text`
- `pos`
- `anchor`
- `scale`
- `rot`
- `opacity`
- `animatedTransforms`

In the bars example:

- `pos` is static
- `opacity` is animated
- `animatedTransforms` is usually `["opacity"]`

In the Tulsa tracking JSON, a layer like `text_102_d|...` has:

- `start: 20`
- `end: 61`
- `animatedTransforms: ["pos", "opacity"]`
- `pos`: a list of 42 sampled `[x, y]` values
- `opacity`: a list of 42 sampled values

That means:

- NYT is not limited to fixed labels
- the format supports per-frame motion tracks
- active ranges are inclusive
- sampled arrays line up exactly with `end - start + 1`

For example:

- `start: 20`
- `end: 61`
- active span = `61 - 20 + 1 = 42`
- `pos.length = 42`
- `opacity.length = 42`

### 5. The NYT model appears to be a sampled runtime format

The evidence suggests this representation is optimized for playback, not authoring:

- static values stay scalar/vector
- animated values are sampled arrays
- `animatedTransforms` explicitly flags which properties vary over time

This is likely a derived browser format, not a direct AE project representation.

## What After Effects Gives Us

After Effects does not naturally produce a clean browser runtime format on its own.

AE's native model is based on:

- layers
- transforms
- text animators and selectors
- keyframes
- expressions

For text in particular, AE commonly uses:

- layer transforms like position, scale, rotation, opacity
- text animators
- range selectors
- expressions on `Source Text` or animated properties

Important implication:

- AE is an authoring environment
- a web exporter still has to decide what browser data model to emit

So the question is not "How do we parse AE exactly?" The question is:

> What subset of temporal annotation behavior do we want to support on the web?

## Problem Statement

The current `all2html` IR is optimized for static/responsive scenes:

- artboards
- layers
- positioned elements
- one spatial state per element

Temporal media introduces a different class of problem:

- a media source changes over time
- overlays can appear/disappear
- overlays can move
- the playback can be controlled by scroll, autoplay, stepper, or manual seeking

Trying to force that into the existing static artboard model would likely produce an awkward and brittle design.

At the same time, this should not become a completely separate product with no shared types.

## Shared Primitives vs Divergent Scene Models

The right split is:

- shared content primitives
- separate scene structures

### Shared primitives

These should remain shared between static and temporal content:

- assets
- text content
- text style
- geometry primitives
- transforms
- breakpoints / responsive variants
- metadata and accessibility
- output settings

Example shared ideas:

- `Asset`
- `RichText`
- `TextStyle`
- `Point`
- `Size`
- `BreakpointRange`
- `Metadata`
- `Settings`

### Divergent scene structures

These should likely diverge:

- static/responsive artboards
- temporal media scenes

So the split is not "two unrelated systems." It is:

- same vocabulary
- different grammar

## Candidate Approaches

### Approach 1: Baked video + lightweight overlay metadata

This is the closest to the NYT bars implementation.

#### Model

- render motion graphics from AE to MP4
- export annotation metadata separately
- annotations have timing windows
- labels can be fixed-position
- optional sampled opacity tracks
- optional sampled position tracks

#### Pros

- easiest for motion designers
- highest fidelity to rendered motion
- simplest runtime
- easiest browser compatibility
- easiest first prototype
- does not require recreating AE animation semantics on the web

#### Cons

- motion inside the media is baked and not editable
- less semantic than pure DOM/SVG animation
- responsive relayout of overlays requires extra metadata
- accessibility depends on the overlay layer, not the media itself

#### Best use

- newsroom pieces where the motion work itself is the main product
- overlay labels and annotations are secondary

### Approach 2: Lottie/Bodymovin + controller

This uses the existing AE-to-web ecosystem.

#### Model

- export AE via Bodymovin/Lottie
- render with a Lottie player
- drive playback via scroll or another controller
- add overlay annotations or use built-in text/shapes where supported

#### Pros

- mature ecosystem
- keyframes + interpolation already exist
- good for vector-rich motion
- can combine with GSAP `ScrollTrigger`

#### Cons

- Lottie does not support every AE feature cleanly
- can become brittle on complex comps
- Lottie JSON is not a pleasant source format
- less aligned with the current `all2html` architecture

#### Best use

- a quick AE-to-web prototype
- vector animation-heavy pieces

### Approach 3: Custom temporal authoring schema + compile to runtime

This is the most strategic path for `all2html`.

#### Model

- define a clean source schema for temporal media
- keep static values separate from animated values
- allow sparse keyframes or simple time windows
- compile to a runtime format, optionally sampled per frame

#### Pros

- cleanest long-term architecture
- readable source format
- easiest to validate
- can support both scroll and non-scroll playback
- best fit for `all2html` if this becomes a real product feature

#### Cons

- most design work up front
- exporter logic is more involved
- runtime must handle interpolation or compilation

#### Best use

- long-term product direction
- reusable temporal annotation support across tools

### Approach 4: Frame sequence + overlay metadata

This is a hybrid where the motion is baked but not as a video stream.

#### Model

- render a sequence of images
- export overlay metadata separately
- controller maps progress to frame index

#### Pros

- exact frame control
- deterministic scrubbing
- easier than recreating AE semantics in browser

#### Cons

- heavy payload
- more asset management complexity
- mobile performance risk

#### Best use

- pieces where frame-accurate scrubbing matters more than file size

## Recommendation

Use a hybrid strategy:

### 1. Authoring format

Use a sparse, semantic temporal schema.

- static values in one place
- animated values in a separate `motion` section
- optional keyframes
- optional direct sampled tracks when needed

### 2. Runtime format

Allow compilation to a NYT-style sampled representation.

- sampled arrays only for properties that animate
- arrays aligned to `start` / `end`
- simple playback engine

This gives:

- readable and maintainable source data
- exact and simple playback output

## Proposed Data Model

### Top-level temporal scene

```json
{
  "type": "temporal-media",
  "id": "main",
  "media": {
    "kind": "video",
    "src": "move.mp4",
    "poster": "move.jpg",
    "frameRate": 30,
    "frameLength": 720,
    "width": 1920,
    "height": 1080
  },
  "playback": {
    "mode": "scroll",
    "scrollStart": 0.04,
    "scrollEnd": 0.95
  },
  "variants": []
}
```

### Responsive variants

Temporal media can still have desktop/mobile or width-based variants.

Example:

```json
{
  "variants": [
    {
      "breakpoint": { "max": 767 },
      "media": { "...": "mobile asset set" },
      "annotations": [ ... ]
    },
    {
      "breakpoint": { "min": 768 },
      "media": { "...": "desktop asset set" },
      "annotations": [ ... ]
    }
  ]
}
```

This means:

- splitting static and temporal scene models does not lose responsive variants
- desktop/mobile distinctions remain inside the temporal branch

### Annotation model

```json
{
  "id": "text-release",
  "kind": "text",
  "start": 474,
  "end": 511,
  "content": {
    "text": "Release",
    "altText": "Label appears when the gymnast releases the bar."
  },
  "style": {
    "fontFamily": "Franklin",
    "fontSize": 16,
    "fontWeight": 500,
    "color": "#ffffff",
    "textAlign": "center"
  },
  "static": {
    "pos": [0.42, 0.39],
    "anchor": [0.5, 0.5],
    "scale": [1, 1],
    "rot": 0,
    "opacity": 1
  },
  "motion": {
    "opacity": {
      "kind": "samples",
      "values": [0, 0.11, 0.22, 0.33, 0.44, 0.56, 0.67, 0.78, 0.89, 1]
    }
  }
}
```

### Motion model

Animated properties should live under `motion`, not be overloaded into the same field shape as static values.

Supported properties in v1:

- `pos`
- `opacity`
- `scale`
- `rot`

Possible motion forms:

#### Samples

```json
{
  "kind": "samples",
  "values": [[0.329, 0.393], [0.328, 0.392], [0.327, 0.392]]
}
```

#### Keyframes

```json
{
  "kind": "keyframes",
  "frames": [
    { "t": 20, "value": [0.329, 0.393] },
    { "t": 61, "value": [0.301, 0.365] }
  ],
  "easing": "linear"
}
```

### Optional compiled runtime format

The source model can be compiled to a simpler playback artifact:

```json
{
  "stage": {
    "width": 1600,
    "height": 900,
    "frameRate": 30,
    "frameLength": 620
  },
  "layers": {
    "text_102": {
      "start": 20,
      "end": 61,
      "type": "text",
      "text": { "...": "..." },
      "static": {
        "anchor": [0, 0],
        "scale": [1, 1],
        "rot": 0
      },
      "animated": {
        "pos": [[0.329, 0.393], [0.328, 0.392]],
        "opacity": [0, 0.028, 0.104]
      }
    }
  }
}
```

This keeps the NYT-style playback simplicity while avoiding their more redundant `animatedTransforms` pattern.

## Why Not Just Copy The NYT Runtime Format As The Canonical IR?

### Argument for doing that

- proven production model
- extremely simple runtime
- exact fidelity
- easy exporter logic
- good fit for scroll scrubbing

### Argument against doing that

- poor source readability
- per-frame arrays are awkward to diff and maintain
- static vs animated shapes become muddled
- weak as an authoring model
- harder to extend elegantly later

### Conclusion

Use NYT-style sampled arrays as a compiled runtime target, not as the only source-level IR.

## How Playback Works

Playback should be treated separately from content.

Possible modes:

- `scroll`
- `autoplay`
- `stepper`
- `manual`

That means the same temporal scene can be reused in different contexts.

This is important because the initial NYT examples are scroll-linked, but the more general primitive is:

- temporal media
- timed overlays

not:

- scrollytelling only

## Proposed Runtime Rules

At frame `f`:

1. skip annotation if `f < start` or `f > end`
2. for each property:
   - if sampled, index into `values[f - start]`
   - else if keyframed, interpolate
   - else use static value

This is simple and predictable.

## Export Strategy From AE

The exporter should not attempt to encode all of AE.

Instead it should support a constrained convention:

- one comp = one temporal scene
- render video or frame sequence
- extract named text layers as annotations
- extract layer transforms
- optionally bake any needed property to per-frame samples
- support markers or naming conventions for timing if useful

This gives a practical bridge from AE authoring to browser playback.

## Proposed Implementation Phases

### Phase 1: basic temporal media prototype

Support:

- video media
- scroll playback
- text annotations only
- `start` / `end`
- static position
- sampled opacity

No moving overlays yet.

### Phase 2: sampled motion support

Add:

- sampled `pos`
- responsive variants
- better annotation layout/accessibility

This gets us close to the Tulsa pattern.

### Phase 3: keyframes and compilation

Add:

- sparse keyframe authoring
- compile-to-samples step
- autoplay and stepper playback

### Phase 4: richer overlays

Add:

- SVG/shape overlays
- more animated attributes
- optional tracked geometry

## Evaluation Criteria

Anyone evaluating this proposal should consider:

### 1. Architectural fit

- does this keep static and temporal concerns separated enough?
- does it still reuse shared project primitives?

### 2. Export practicality

- can an AE pipeline realistically emit this?
- does it require too much reverse-engineering of AE?

### 3. Runtime simplicity

- can the browser runtime stay small and deterministic?
- can scroll scrubbing be smooth?

### 4. Readability and maintenance

- can humans inspect and diff the source data?
- can the runtime format be validated automatically?

### 5. Accessibility

- are text overlays semantic and screen-reader-friendly?
- can media and annotations expose meaningful alt text?

### 6. Responsiveness

- can desktop/mobile variants be represented cleanly?
- can annotation coordinates adapt per breakpoint?

### 7. Product scope

- is this a sibling workflow to `ai2html`, or should it be a distinct tool mode?

## Recommended Decision

The strongest path is:

1. add a temporal scene branch alongside the current static artboard branch
2. keep shared primitives under both
3. define a clean sparse authoring schema
4. allow compilation to sampled per-frame playback data

This gives the project:

- a path toward NYT-style temporal graphics
- compatibility with AE-oriented export workflows
- a runtime model simple enough to trust
- a source model clean enough to evaluate and maintain

## References

Local files examined:

- [temp/bars.html](/Users/soma/Development/all2html/temp/bars.html)
- [temp/tulsa.html](/Users/soma/Development/all2html/temp/tulsa.html)

Relevant external references:

- NYT bars tracking JSON  
  `https://static01.nytimes.com/newsgraphics/2024-04-25-suni-lee-bars/6d433d31-a99a-407c-907f-3de14e21f9fb/_assets/tracking-desktop.json`

- NYT Tulsa chapter tracking JSON  
  `https://static01.nytimes.com/newsgraphics/2021/03/22/tulsa-massacre-centennial/47ebd8bc23cd5948bd03030e261d0e6dfec311f5/chapter-2/ch2-business-d12.json`

- Adobe text expressions  
  `https://helpx.adobe.com/si/after-effects/using/expressions-text-properties.html`

- Adobe expression language  
  `https://helpx.adobe.com/si/after-effects/using/expression-language.html`

- After Effects scripting render queue  
  `https://ae-scripting.docsforadobe.dev/renderqueue/renderqueue/`

- Lottie docs  
  `https://lottiefiles.github.io/lottie-docs/properties/`

- GSAP ScrollTrigger  
  `https://gsap.com/docs/v3/Plugins/ScrollTrigger/`
