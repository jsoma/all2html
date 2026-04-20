# all2html — Technical Specification

## 1. Overview

**all2html** is a plugin-based system that converts design tool documents into responsive HTML. It is a clean-room reimplementation of ai2html (NYT's Illustrator-to-HTML tool) with a canonical IR boundary between exporters and the rendering core. Illustrator is the currently supported production exporter; Figma now has a runnable in-repo beta plugin flow with a newsroom-facing UI, but it is not yet a hardened user-facing exporter.

### Core Idea

```
Design Tool  →  [Input Plugin: extracts data]  →  IR (JSON + images)  →  [Core: renders]  →  Output (HTML/Svelte/React)
```

- **Input plugins** run inside design tools. They extract text, layers, styles, and images into a standardized Intermediate Representation (IR).
- **Core library** (TypeScript/Node.js) processes the IR through a series of transforms and emits output in the desired format.
- **Output emitters** are format-specific renderers. The HTML emitter produces ai2html-compatible fragments. The Svelte and React emitters are full component emitters with their own APIs, runtime code, and rendering strategies — not thin wrappers around HTML.

### v1 Scope

- Illustrator parity with ai2html (v0.123.4)
- ExtendScript input plugin for Illustrator
- HTML fragment output (default)
- Svelte and React component emitters (static component shells with `assetsPath` prop; no interactive features)
- Near pixel-perfect fidelity with ai2html's output
- LTR horizontal text only
- Text is locked (not copy-editable post-export)
- CSS custom property image loading for container queries
- IR schema includes snippet and tagged text types (for forward compatibility; emitters may ignore in v1)

### v1.1+ Roadmap

Features spec'd below but deferred past v1. The IR schema and emitter contracts are designed to accommodate them without breaking changes.

- **v1.1 — Snippets**: SnippetElement support in Svelte/React emitters (interactive component placeholders)
- **v1.2 — Tagged text**: Binding-based text overrides in Svelte/React emitters
- **v1.1 — Percentage positioning**: Emitter option `positionMode: 'percentage' | 'absolute'` for fluid text scaling without JS
- **v2 — Artboard change events**: `onArtboardChange` callback in component emitters

### Non-Goals (v1)

- RTL / complex scripts / vertical text
- Copy-editable output
- Image bandwidth optimization (`<picture>` tags, lazy loading non-visible artboards)
- IR versioning (pre-release)
- A hardened, user-facing Figma or After Effects exporter in v1
- CEP panel UI, XMP metadata persistence, profile system, shadow/animation presets (see ai2svelte analysis in `research/`)

---

## 2. Architecture

### 2.1 Exporter / Core Boundary

**Principle:** The exporter answers "what's in the document?" The core answers "how do we render it?"

The exporter handles things that **only the design tool can know**:
- Document structure (artboards, layers, elements)
- Text content with style attributes (font names, sizes, colors, tracking, leading)
- Element positions in absolute pixels (top-left origin, per-artboard coordinate space)
- Clipping mask visibility (which elements are hidden by masks)
- Rasterization decisions (what must be an image vs what stays as text/SVG)
- Image export (artboard backgrounds, PNG layers, SVG layers)
- Design-tool-specific metadata (Illustrator font identifiers, layer annotations)

The core handles everything **tool-agnostic**:
- Settings resolution (merge defaults + config file + IR settings)
- CSS style computation (AI font → CSS font-family/weight/style)
- Style deduplication (most common = base, variants get classes)
- Position conversion (absolute pixels → percentages of artboard)
- Responsive breakpoint calculation
- Container query CSS generation
- HTML/Svelte/React assembly
- Asset manifest management

### 2.2 Core Processing Model — IR-in, IR-out Transforms

The IR JSON is the data format throughout. Transform functions take IR and return enriched IR. No scene graph, no visitor pattern.

```typescript
let doc = loadAndValidateIR(irJson);    // parse + Zod validation
doc = resolveSettings(doc, configFile); // merge settings chain
doc = computeBreakpoints(doc);          // assign visibility ranges
doc = computeStyles(doc);              // AI styles → CSS properties
doc = deduplicateStyles(doc);          // find base style, assign classes
doc = computePositions(doc);           // absolute px → percentages

// Emit to desired format
const html = emitHTML(doc);
const svelte = emitSvelte(doc);
```

**Phase types** (for validation between steps):
- `RawIR` — as produced by the exporter
- `ResolvedIR` — settings merged, breakpoints computed
- `StyledIR` — CSS properties computed, styles deduplicated
- `EmitterReadyIR` — positions as percentages, everything ready for output

**Transform discipline:**
- Shallow-clone the document at each transform boundary, mutate the clone internally
- Validate between phases with lightweight invariants (IDs unique, assets exist, positions resolved)
- Stable ordering: artboards by width, layers by z-order (bottom to top), elements by position (top-to-bottom, left-to-right)

### 2.3 Output Generation — hast (Hypertext Abstract Syntax Tree)

We use `hast` from the unified ecosystem to build an HTML tree, then serialize it. This gives us:
- Type-safe tree construction
- Correct escaping by default
- Battle-tested serializer (`hast-util-to-html`)
- React serializer (`hast-util-to-jsx-runtime`)
- Deterministic output
- Custom code blocks quarantined as explicit raw nodes

Custom code injection (`ai2html-html`, `ai2html-js`, `ai2html-css`) is represented as raw/dangerous nodes — they bypass escaping intentionally.

### 2.4 Project Structure — Single Package, Clean Boundaries

```
all2html/
├── package.json
├── tsconfig.json
├── SPEC.md
├── src/
│   ├── index.ts                    # public API
│   ├── ir/
│   │   ├── schema.ts               # IR type definitions
│   │   ├── validate.ts             # Zod validation
│   │   └── types.ts                # shared types (Color, Position, etc.)
│   ├── core/
│   │   ├── resolve-settings.ts     # settings merge chain
│   │   ├── compute-breakpoints.ts  # artboard visibility ranges
│   │   ├── compute-styles.ts       # AI style → CSS conversion
│   │   ├── deduplicate-styles.ts   # style dedup, class assignment
│   │   ├── compute-positions.ts    # absolute → percentage positions
│   │   ├── font-map.ts             # font lookup + weight guessing
│   │   └── pipeline.ts             # orchestrates transforms
│   ├── emitters/
│   │   ├── html.ts                 # HTML fragment emitter
│   │   ├── svelte.ts               # Svelte component emitter
│   │   ├── react.ts                # React component emitter
│   │   ├── standalone.ts           # Full standalone HTML page
│   │   ├── types.ts                # EmitterOptions, emitter contract types
│   │   └── shared/
│   │       ├── css.ts              # CSS generation (shared across emitters)
│   │       ├── hast-helpers.ts     # hast tree construction utilities
│   │       └── assets.ts           # asset path resolution + %%ASSET_PATH%% token
│   └── cli/
│       └── index.ts                # CLI entry point
├── plugins/
│   └── illustrator/
│       ├── all2html.js             # ExtendScript exporter
│       └── README.md
├── test/
│   ├── fixtures/
│   │   ├── ir/                     # hand-crafted IR JSON files
│   │   ├── golden/                 # expected output snapshots
│   │   │   ├── html/
│   │   │   └── screenshots/
│   │   ├── ai-files/               # actual .ai test files
│   │   └── ai2html-reference/      # ai2html output for same files
│   ├── unit/                       # per-transform tests
│   ├── integration/                # full pipeline tests
│   └── visual/                     # Playwright screenshot tests
└── research/                       # ai2html analysis, transcripts, specs
```

**Boundary enforcement:** TypeScript path aliases and barrel exports. `plugins/illustrator/` must not import from `src/core/` — it only depends on the IR schema types. The public API is `src/index.ts`.

---

## 3. Intermediate Representation (IR) Schema

### 3.1 Document

```typescript
interface Document {
  generator: {
    tool: string;           // "illustrator", "figma", etc.
    toolVersion: string;    // "29.0"
    pluginVersion: string;  // "0.1.0"
  };

  settings: Settings;
  fonts: FontMapping[];
  artboards: Artboard[];
  customBlocks: CustomBlock[];
  assets: Record<string, Asset>;

  metadata: {
    slug: string;             // derived from filename
    headline?: string;
    leadin?: string;
    summary?: string;
    notes?: string;
    sources?: string;
    credit?: string;
    altText?: string;
    imageAltText?: string;
    ariaRole?: string;
    [key: string]: JsonValue | undefined;  // arbitrary passthrough metadata
  };
}
```

### 3.1.1 Emitter Options

Emitter-specific options live outside the IR `settings` (which are exporter-generated, tool-agnostic). They are provided via config file or CLI flags and passed directly to the emitter — the core pipeline ignores them.

```typescript
interface EmitterOptions {
  html?: {
    positionMode?: "percentage" | "absolute";
    allowUnsafeHtml?: boolean;
  };
  svelte?: {
    positionMode?: "percentage" | "absolute";
    allowUnsafeHtml?: boolean;
  };
  react?: {
    positionMode?: "percentage" | "absolute";
    allowUnsafeHtml?: boolean;
    typescript?: boolean;            // emit .tsx vs .jsx (default false)
  };
  standalone?: {
    positionMode?: "percentage" | "absolute";
    allowUnsafeHtml?: boolean;
  };
}
```

**Why not in Settings?** Settings are embedded in the design tool document (via `ai2html-settings` text block) and travel with the IR. Emitter options are render-target concerns — you don't want `emit.positionMode` or `react.typescript` appearing in an Illustrator text block. The config file supports both:

```json
{
  "settings": { "responsiveness": "dynamic" },
  "fonts": [...],
  "emit": {
    "html": { "positionMode": "percentage" },
    "react": { "typescript": true }
  }
}
```

Core merges `settings`; each emitter reads its own section from `emit`.

### 3.2 Settings

```typescript
interface Settings {
  // Image settings
  imageFormat: ("auto" | "png" | "png24" | "jpg" | "svg")[];
  writeImageFiles: boolean;
  pngTransparent: boolean;
  pngNumberOfColors: number;    // 1-256
  jpgQuality: number;           // 0-100
  use2xImages: boolean;
  cacheBustToken?: number;

  // Output settings
  namespace: string;            // default "g-"
  projectName?: string;
  output: "one-file" | "multiple-files";
  htmlOutputPath: string;
  htmlOutputExtension: string;
  imageOutputPath: string;
  imageSourcePath: string;

  // Rendering
  responsiveness: "fixed" | "dynamic";
  textResponsiveness: "fixed" | "dynamic";
  maxWidth?: number;
  centerHtmlOutput: boolean;
  renderTextAs: "html" | "image";
  renderRotatedSkewedTextAs: "html" | "image";
  testingMode: boolean;

  // Features
  includeResizerCss: boolean;
  includeResizerWidths: boolean;
  useLazyLoader: boolean;
  inlineSvg: boolean;
  svgIdPrefix: string;
  svgEmbedImages: boolean;
  clickableLink?: string;
  createPromoImage: boolean;
  promoImageWidth: number;
  localPreviewTemplate?: string;
}
```

### 3.3 Artboard

```typescript
interface Artboard {
  name: string;                  // cleaned name (no `:` suffix, no ` copy`)
  originalName: string;          // raw artboard name from design tool
  width: number;                 // effective width (may be overridden via name)
  height: number;
  actualWidth: number;           // true pixel width
  actualHeight: number;

  // Per-artboard overrides (from name annotation)
  responsiveness?: "fixed" | "dynamic";
  imageOnly?: boolean;           // skip text-to-HTML, render all as image

  layers: Layer[];
}
```

### 3.4 Layer

```typescript
interface Layer {
  name: string;                  // cleaned layer name
  type: "default" | "svg" | "png" | "symbol" | "div"
      | "video" | "html-before" | "html-after";
  inlineSvg: boolean;            // for svg layers: embed inline?
  visible: boolean;
  opacity: number;               // 0-100
  elements: Element[];
}
```

**Design note:** `Layer.type` represents the **export/rendering strategy** for the layer's contents. Semantic annotations like snippets and tagged text are expressed on their *elements* (`SnippetElement`, `TextElement.binding`), not on the layer. A layer containing snippet placeholders has `type: "default"` — the exporter creates `SnippetElement`s from shapes it finds on `:snippet`-annotated layers. This keeps core transforms from needing to special-case layer types that are really API annotations.

### 3.5 Elements

```typescript
type Element = TextElement | ShapeElement | VideoElement | RawHtmlElement | SnippetElement;

interface TextElement {
  type: "text";
  id: string;                    // from object name, or auto-generated
  kind: "point" | "area";
  position: BoundingBox;         // absolute pixels, artboard-relative, top-left origin
  rotation?: number;             // degrees (only if > 1 degree)
  transformMatrix?: number[];    // [a, b, c, d, e, f] for rotated text
  opacity: number;               // computed through parent chain, 0-100
  blendMode?: "multiply";        // only multiply is supported

  // Text-specific
  valign: "top" | "middle" | "bottom";
  paragraphs: Paragraph[];

  // Text effects (drop shadows, blurs)
  effects?: TextEffect[];

  // Area text path styling (experimental)
  areaFill?: Color;
  areaBorder?: { width: number; color: Color };

  // Exporter metadata
  renderAs: "html" | "image";   // what the exporter decided
  dataAttributes?: Record<string, string>;  // from note field

  // Tagged text binding (v1.2+)
  // When present, component emitters replace static text with a runtime expression
  // bound to a component prop. Core pipeline still processes text normally (styles,
  // positions, dedup) so the placeholder is styled correctly.
  binding?: {
    path: string;                // stable key path, e.g., "headlines.main"
    allowHtml: boolean;          // true = raw HTML injection (`:htext`), false = text only (`:text`)
  };
}

interface Paragraph {
  text: string;
  alignment: "left" | "center" | "right" | "justify";
  leading: number;               // line height in px
  spaceBefore: number;           // padding-top in px
  spaceAfter: number;            // padding-bottom in px
  runs: CharacterRun[];
}

interface CharacterRun {
  text: string;
  fontName: string;              // Illustrator internal font name (e.g., "ArialMT")
  fontPostScriptName?: string;   // PostScript name if available
  fontSize: number;              // in px
  color: Color;
  tracking: number;              // AI tracking value (divide by 1000 for em)
  capitalization: "normal" | "allcaps" | "smallcaps";
  baselineShift: "normal" | "superscript" | "subscript";
  hyperlink?: { href: string; target?: string };  // inline link (Figma-native; future Illustrator support)
}

// Text effects — extracted from design tool effects, deduplicated into g-effect{N} classes
type TextEffect = DropShadowEffect | BlurEffect;

interface DropShadowEffect {
  type: "dropShadow";
  offsetX: number;               // horizontal offset in px
  offsetY: number;               // vertical offset in px
  blurRadius: number;            // blur radius in px
  color: Color;                  // shadow color with opacity
}

interface BlurEffect {
  type: "blur";
  radius: number;                // blur radius in px → CSS filter: blur()
}

interface ShapeElement {
  type: "shape";
  shapeType: "rectangle" | "circle" | "line";
  id?: string;
  position: BoundingBox;
  fill?: Color;
  stroke?: { width: number; color: Color };
  opacity: number;
  blendMode?: "multiply";

  // Line-specific
  orientation?: "horizontal" | "vertical";
  segments?: { x1: number; y1: number; x2: number; y2: number }[];
}

interface VideoElement {
  type: "video";
  url: string;                   // https .mp4 URL
}

interface RawHtmlElement {
  type: "rawHtml";
  content: string;
}

interface SnippetElement {
  type: "snippet";
  key: string;                   // stable identifier (from layer name prefix)
  group?: string;                // optional grouping (layer name, for multi-region snippets)
  position: BoundingBox;         // mount region position, absolute pixels
  geometry?: {                   // optional shape info (for visual guides)
    kind: "rectangle" | "circle" | "line";
  };
  visible?: boolean;             // whether shape was visible in design (default true)
}
```

#### Snippet Elements

A snippet is a **runtime mount region** — a positioned placeholder where the consumer can inject interactive content. The exporter creates `SnippetElement`s from shapes found on `:snippet`-annotated layers. The `key` field is framework-agnostic; emitters map it to their idiom (Svelte `{@render}` snippet prop, React `ReactNode` prop, Web Component slot).

Multiple `SnippetElement`s can share the same `key` (e.g., one per artboard in a responsive set). The `group` field preserves the layer name for disambiguation.

#### Tagged Text Bindings

The `binding` field on `TextElement` marks text as overridable at runtime. The core pipeline processes it normally (styles, positions, dedup) so the placeholder is styled correctly. Component emitters replace the static content with framework-specific expressions:

- **Svelte**: `{taggedText?.headlines?.main || 'placeholder'}` (text) or `{@html taggedText?.headlines?.main || ''}` (html)
- **React**: `{taggedText?.headlines?.main || 'placeholder'}` (text) or `dangerouslySetInnerHTML` (html)
- **HTML**: Static text, binding ignored

**Security note:** `allowHtml: true` is raw HTML injection. Emitters must document this as "trusted content only" and generate framework-appropriate unsafe rendering (`{@html}`, `dangerouslySetInnerHTML`). The IR makes the trust boundary explicit so consumers can audit which text frames accept raw HTML.

#### Stable Identifiers

Both `SnippetElement.key` and `TextElement.binding.path` are consumer-facing API surfaces. If they change between exports, consumer code breaks. The exporter must use **deterministic naming**:

1. **Prefer the Illustrator object name** if the user has explicitly named it
2. **Fall back to the layer name** for snippet keys
3. **For tagged text path**: `{layerNamePrefix}.{objectName}` — e.g., a text frame named "main" on a layer "headlines:text" → `binding.path = "headlines.main"`
4. Object names must be valid JS identifiers (sanitize: replace non-alphanumeric with `_`, strip leading digits)
5. Warn if auto-generated IDs are used (unstable across re-exports)

### 3.6 Supporting Types

```typescript
interface BoundingBox {
  x: number;       // left edge, px from artboard left
  y: number;       // top edge, px from artboard top
  width: number;   // px
  height: number;  // px
}

interface Color {
  r: number;       // 0-255
  g: number;
  b: number;
  opacity?: number; // 0-100 (omit for fully opaque)
}

interface FontMapping {
  aifont: string;                // AI internal font name
  family: string;                // CSS font-family
  weight?: string;               // CSS font-weight
  style?: string;                // CSS font-style ("italic")
  vshift?: string;               // vertical shift as % (e.g., "8%"), point text only
}

interface CustomBlock {
  type: "css" | "js" | "html" | "html-before" | "html-after";
  content: string;               // cleaned content (curly quotes straightened)
}

interface Asset {
  id: string;                    // unique identifier
  path: string;                  // relative file path
  hash?: string;                 // content hash (computed by core if not provided)
  mimeType: string;              // "image/png", "image/jpeg", "image/svg+xml"
  width: number;                 // pixel width
  height: number;                // pixel height
  artboardName: string;          // which artboard this belongs to
  layerName?: string;            // which layer (for :png, :svg layers)
  exportParams: {
    format: string;
    scale: number;               // 1 or 2 (retina)
    transparent?: boolean;
    quality?: number;            // jpg quality
    colors?: number;             // png8 color count
  };
}
```

---

## 4. ExtendScript Exporter (plugins/illustrator/)

### 4.1 Responsibilities

The ExtendScript exporter:
1. Validates the document (RGB, saved, not in isolation mode, not editing opacity mask)
2. Reads settings from `ai2html-settings` / `ai2html-text` text blocks
3. Reads custom code blocks (`ai2html-css`, `ai2html-js`, `ai2html-html-*`)
4. Walks the document structure: artboards → layers → text frames / shapes
5. Detects clipping masks and marks hidden elements
6. Decides what to rasterize vs what stays as text/SVG
7. Detects `:snippet` layers → creates `SnippetElement`s from shapes (v1.1+)
8. Detects `:text`/`:htext` layers → sets `TextElement.binding` with stable paths (v1.2+)
9. Exports images (artboard backgrounds, `:png` layers, `:svg` layers)
10. Produces the IR JSON file
11. Optionally invokes the core (if Node.js is available) or writes IR to disk

### 4.2 Coordinate Contract

All positions in the IR use:
- **Top-left origin** (Y increases downward)
- **Absolute pixels** relative to the artboard's top-left corner
- The exporter handles Illustrator's coordinate quirks (bottom-left origin, artboard offsets)

### 4.3 Rasterization Policy

For each element, the exporter records `renderAs`:
- `"htmlText"` — text frames that should become HTML overlays
- `"image"` — text frames that should be baked into the background image (rotated text when `renderRotatedSkewedTextAs: "image"`, or artboards with `imageOnly` flag)

The background image for each artboard is exported with all `renderAs: "htmlText"` frames hidden.

### 4.4 Output

The exporter writes to the `imageOutputPath` directory:
```
output/
├── ir.json                          # the IR document
├── {slug}-{artboard}.png            # artboard background images
├── {slug}-{artboard}-{layer}.svg    # SVG layer exports
├── {slug}-{artboard}-{layer}.png    # PNG layer exports
└── {slug}-promo.png                 # promo image (optional)
```

### 4.5 What the Exporter Does NOT Do

- CSS generation
- Style deduplication
- Position-to-percentage conversion
- Responsive breakpoint calculation
- HTML/Svelte/React assembly
- Font mapping (it records raw AI font names; the core maps them)
- Snippet rendering decisions (it creates SnippetElements; emitters decide how to render them)
- Tagged text expression generation (it sets binding metadata; emitters generate framework expressions)

---

## 5. Core Processing Pipeline

### 5.1 loadAndValidateIR

- Parse JSON
- Validate against Zod schema
- Fail loudly with exact error paths on invalid IR

### 5.2 resolveSettings

- Start with built-in defaults
- Merge `all2html.config.json` (global, then local)
- Merge IR settings (from `ai2html-settings` block)
- Merge font mappings (fonts from config extend/override IR fonts)
- Result: fully resolved settings on the document

### 5.3 computeBreakpoints

For each artboard group (same-named artboards = responsive variants):
- Sort by effective width
- Assign visibility ranges: `[0, nextWidth-1]`, `[nextWidth, nextNextWidth-1]`, ..., `[lastWidth, Infinity]`
- Assign width ranges (for dynamic artboards: visibility range; for fixed: `[width, width]`)

### 5.4 computeStyles

For each text element on each artboard:
- Look up font in font table (`findFontInfo`)
  - If found: use mapped `family`, `weight`, `style`, `vshift`
  - If not found: guess weight from name ("Bold" → 700, else 500), style from "Italic"
  - Record warning for unmapped fonts
- Convert AI text properties to CSS:
  - `tracking` → `letter-spacing` (tracking / 1000 em)
  - `leading` → `line-height` (px)
  - `spaceBefore` → `padding-top` (px)
  - `spaceAfter` → `padding-bottom` (px)
  - `capitalization` → `text-transform`
  - `baselineShift` → `vertical-align` + font-size × 0.7
  - `color` → `color` (snap near-black to pure black: RGB all < 36)
  - `opacity` → `opacity`
  - `blendMode` → `mix-blend-mode`
  - `alignment` → `text-align`
  - `vshift` → `position: relative; top: Xpx` (point text only)
- For point text: set `height` = `line-height` (Chrome/Safari zoom fix)
- For area text with path styling: add `background-color` and/or `border` with padding

### 5.5 deduplicateStyles

1. Collect all paragraph styles across the artboard
2. Sort by total character count; most common = base `<p>` style
3. For each paragraph differing from base: assign `g-pstyle{N}` class with only the CSS diff
4. Within each paragraph, find most common character style → promote to paragraph level
5. For character runs differing from their paragraph: assign `g-cstyle{N}` class with only the CSS diff
6. Use stable key generation: sort CSS properties alphabetically, join with `~`

### 5.6 computePositions

Convert absolute pixel positions to percentages of artboard dimensions:
- Horizontal: based on alignment (left-aligned → `left: X%`, right-aligned → `right: X%`, center → `left: X%; margin-left: -Wpx`)
- Vertical: based on `valign` (top → `top: Y%`, middle → `top: Y%; margin-top: -Hpx`, bottom → `bottom: Y%`)
- Area text width: percentage when `textResponsiveness: "dynamic"`, pixels when `"fixed"`
- Point text width: always pixels (+ 22px overflow padding)
- All values rounded to 4 decimal places

### 5.7 Emitter Contract

Every emitter must define:

1. **Generated files**: What files it writes (component, CSS, asset manifest, types)
2. **Runtime requirements**: What browser/runtime APIs are needed (container queries, ResizeObserver, DOM)
3. **SSR behavior**: Whether the output works in server-side rendering (no DOM access during initial render)
4. **Security model**: How raw HTML injection (`binding.allowHtml`, custom code blocks) is handled
5. **Asset path resolution**: How image `src` attributes are constructed (static prefix vs runtime prop)
6. **Snippet/binding support level**: Which interactive features are implemented (may be "none" in v1)

### 5.8 HTML Fragment Emitter

Produces the standard ai2html-compatible output:
```html
<!-- Generated by all2html v{version} -->
<style media="screen,print">
  /* Container CSS */
  /* Per-artboard CSS */
  /* Text style CSS */
  /* Custom CSS */
</style>
<div id="{ns}{slug}-box" class="ai2html">
  <!-- alt text, artboards, custom HTML, etc. -->
</div>
<!-- Custom JS -->
<!-- End all2html -->
```

Scoped to `#{ns}{slug}-box` to prevent CSS collisions.

| Property | Value |
|---|---|
| Files | Single `.html` fragment |
| Runtime | Container queries (CSS only, no JS) |
| SSR | N/A (static HTML) |
| Security | Custom code blocks injected as-is (trusted content) |
| Asset paths | Static `imageSourcePath` prefix |
| Snippets | Ignored — rendered as empty positioned divs |
| Bindings | Ignored — static placeholder text rendered |

#### CSS Custom Property Image Loading

When `includeResizerCss` is true and multiple artboards exist, background images use CSS custom properties instead of inline styles. This prevents browsers from downloading images for hidden artboards.

```css
/* Container sets all image vars */
#g-slug-box {
  container-type: inline-size;
}

/* Base: no background image */
.g-aiImg { background-image: none; }

/* Active artboard gets its image via CQ */
@container (min-width: 600px) {
  #g-slug-desktop .g-aiImg {
    background-image: var(--desktop-img);
  }
}
```

The container div receives the CSS custom properties:
```html
<div id="g-slug-box" class="ai2html"
     style="--mobile-img: url('%%ASSET_PATH%%slug-mobile.jpg');
            --desktop-img: url('%%ASSET_PATH%%slug-desktop.jpg');">
```

**Asset path token**: The core generates `%%ASSET_PATH%%` as a placeholder prefix in CSS custom property values. The HTML emitter replaces it with the resolved `imageSourcePath`. Component emitters replace it with their runtime path expression (see below).

#### Artboard Div Attributes

Each artboard div includes `aspect-ratio` as a modern complement to the padding-bottom shim:

```html
<div class="g-artboard" style="aspect-ratio: 600 / 400; ..."
     data-aspect-ratio="1.5" data-min-width="0" data-max-width="599">
  <div style="padding: 0 0 66.6667% 0;"></div>  <!-- padding shim for older browsers -->
  ...
</div>
```

Both `aspect-ratio` and the padding shim are emitted. The shim is a no-op when `aspect-ratio` is supported but provides fallback for older Safari.

### 5.9 Svelte Component Emitter

A full component emitter that generates a `.svelte` file with reactive runtime code.

| Property | Value |
|---|---|
| Files | Single `.svelte` component |
| Runtime | Container queries or reactive width tracking; `bind:clientWidth` |
| SSR | Compatible — width-dependent rendering deferred to `onMount` |
| Security | `binding.allowHtml` → `{@html}` (documented as trusted-only) |
| Asset paths | `assetsPath` prop, runtime interpolation |
| Snippets | `{@render key?.()}` (v1.1+) |
| Bindings | `taggedText.path` expressions (v1.2+) |

#### Component API (Semantic — Not Syntax-Specific)

The spec defines **behavior**, not exact Svelte syntax. Implementation should use current Svelte idioms (runes in Svelte 5, stores in Svelte 4) without locking the spec to a specific Svelte version.

**Props** (all optional):

| Prop | Type | Default | Description |
|---|---|---|---|
| `assetsPath` | string | `'/'` | Base path for image assets. Normalized with trailing slash. Replaces `%%ASSET_PATH%%` in CSS custom property values. |
| `onMounted` | callback | — | Fired after component mounts and artboard DOM is ready |
| `onArtboardChange` | callback | — | Fired when active artboard changes (receives artboard DOM element). Uses container width to determine active artboard from `data-min-width` / `data-max-width`. |
| `{snippetKey}` | render snippet | — | One prop per `SnippetElement.key` in the IR. Rendered at the snippet's position via framework render mechanism. (v1.1+) |
| `taggedText` | object | `{}` | Nested object for text overrides, keyed by `binding.path`. (v1.2+) |

**Responsive strategy**: Two modes based on `includeResizerCss`:
- **Container queries** (default): Same CSS as HTML emitter. `bind:clientWidth` on container for artboard change detection only.
- **Conditional rendering** (fallback): Reactive width tracking with framework conditionals to show/hide artboards.

**CSS**: Uses `<style>` with `#id`-based scoping (same as HTML emitter). All CSS is generated by the shared CSS module. No SCSS dependency — if consumers want SCSS, they post-process.

**Asset path interpolation**: CSS custom property values use the `assetsPath` prop at runtime:
```svelte
<div style:--desktop-img="url({assetsPath}slug-desktop.jpg)">
```

#### Emitter Options (`emit.svelte`)

| Option | Default | Description |
|---|---|---|
| `positionMode` | `"absolute"` | Convert remaining text widths/anchor offsets to percentage-based CSS transforms at emit time |
| `allowUnsafeHtml` | `true` | Suppress `binding.allowHtml` markers when `false` |

### 5.10 React Component Emitter

Parallel to the Svelte emitter, generating a `.jsx` (or `.tsx`) component.

| Property | Value |
|---|---|
| Files | Single `.jsx` or `.tsx` component |
| Runtime | Container queries; `useRef` + `ResizeObserver` for width tracking |
| SSR | Compatible — width-dependent code in `useEffect` only |
| Security | `binding.allowHtml` → `dangerouslySetInnerHTML` (documented as trusted-only) |
| Asset paths | `assetsPath` prop, template literal interpolation |
| Snippets | `ReactNode` props rendered at snippet positions (v1.1+) |
| Bindings | Optional chaining expressions on `taggedText` prop (v1.2+) |

#### Component API

**Props** (all optional):

| Prop | Type | Default | Description |
|---|---|---|---|
| `assetsPath` | string | `'/'` | Base path for image assets |
| `onMounted` | callback | — | Fired in `useEffect` after initial render |
| `onArtboardChange` | callback | — | Fired when active artboard changes |
| `{snippetKey}` | ReactNode | — | One prop per `SnippetElement.key`. Rendered inside positioned wrapper div. (v1.1+) |
| `taggedText` | object | `{}` | Text overrides keyed by `binding.path`. (v1.2+) |

#### Emitter Options (`emit.react`)

| Option | Default | Description |
|---|---|---|
| `typescript` | `false` | Emit `.tsx` with prop types instead of `.jsx` |
| `positionMode` | `"absolute"` | Convert remaining text widths/anchor offsets to percentage-based CSS transforms at emit time |
| `allowUnsafeHtml` | `true` | Suppress `binding.allowHtml` markers when `false` |

### 5.11 Standalone HTML Emitter

Full HTML document with `<!DOCTYPE html>`, `<head>`, proper meta tags, and the graphic in `<body>`. For preview and testing.

---

## 6. Configuration

### 6.1 all2html.config.json

```json
{
  "fonts": [
    {
      "aifont": "HelveticaNeue-Bold",
      "family": "'Helvetica Neue', Helvetica, Arial, sans-serif",
      "weight": "700",
      "style": ""
    }
  ],
  "settings": {
    "namespace": "g-",
    "responsiveness": "fixed",
    "imageFormat": ["auto"]
  },
  "emit": {
    "svelte": { "positionMode": "absolute" },
    "react": { "typescript": false }
  }
}
```

Supports `//` single-line comments (stripped before parsing).

The `emit` section is optional. When absent, emitter defaults apply. The `emit` section is NOT merged from the IR — it only comes from config files and CLI flags.

### 6.2 Resolution Order

1. Built-in defaults
2. Global config: `~/.all2html/config.json`
3. Local config: `./all2html.config.json` (next to the IR)
4. IR settings (from `ai2html-settings` block in the design tool)

Later entries override earlier. Fonts are merged, not replaced.

---

## 7. Testing Strategy

### 7.1 Unit Tests (vitest)

Test each core transform in isolation with hand-crafted IR fixtures.

| Transform | What to Assert |
|---|---|
| `resolveSettings` | Correct merge order, font merging, default values |
| `computeBreakpoints` | Visibility ranges for 1/2/3/4 artboard setups |
| `computeStyles` | Font lookup, weight guessing, CSS property computation, color snapping |
| `deduplicateStyles` | Base style selection, class assignment, CSS diff correctness |
| `computePositions` | Percentage calculations for all alignment × valign combinations |
| `fontMap` | Known font lookups, unknown font heuristic, config override |

### 7.2 Snapshot Tests (golden files)

Feed IR fixtures through the full pipeline, snapshot the output HTML. Compare against committed golden files. Any change triggers a diff review.

Also snapshot the IR at each phase boundary (`resolved.json`, `styled.json`, `emitter-ready.json`) to pinpoint which step diverged on regression.

**Determinism requirements** (critical for stable snapshots):
- Stable class naming: `g-pstyle0` assigned by sorted frequency, then alphabetical key
- Stable CSS property ordering: alphabetical within each rule
- Stable element ordering: artboards by width, text by position (top-to-bottom, left-to-right)
- Rounding: 4 decimal places for all percentage/decimal CSS values

### 7.3 Visual Regression Tests (Playwright)

Primary correctness oracle. Two modes:

**Mode A: Self-consistency**
- Render our output in Playwright at multiple widths (320, 480, 768, 1024, 1440 px)
- Screenshot, compare against committed golden screenshots
- Catches regressions without needing ai2html

**Mode B: ai2html comparison**
- Start with real `.ai` files
- Run ai2html on them (manually, requires Illustrator) → commit HTML output as reference
- Run our ExtendScript exporter on same files → IR → core → our HTML output
- Render both in Playwright, screenshot at same widths
- Compare with `pixelmatch` (allow small threshold for acceptable differences)
- Commit ai2html screenshots as golden files in `test/fixtures/ai2html-reference/`

**Viewport widths for responsive tests:**
- Below smallest artboard
- At each breakpoint (exact width of each artboard)
- Between breakpoints
- Above largest artboard

**Font consistency:** Use only web-safe fonts or Google Fonts loaded via `<link>` in test HTML. Never depend on system fonts for visual tests.

### 7.4 IR Validation Tests

- Every fixture must pass Zod validation
- Test malformed IR: missing fields, wrong types, NaN values, empty arrays
- Assert that `loadAndValidateIR` fails with clear error messages

### 7.5 ExtendScript Exporter Tests

The exporter is hard to test automatically (requires Illustrator). Strategy:

1. **Golden IR fixtures**: Run exporter on known `.ai` files, commit output IR JSON. Re-run and diff.
2. **Manual test protocol**: Checklist of things to verify visually after exporter changes.
3. **IR validation**: All exporter output must pass Zod validation.

### 7.6 Test Fixtures to Create

| Fixture | What It Exercises |
|---|---|
| `single-artboard-basic` | One artboard, mixed text (point + area), basic styling |
| `multi-artboard-responsive` | 3 artboards (mobile/tablet/desktop), breakpoint switching |
| `font-mapping` | Multiple fonts, weights, styles, unknown font fallback |
| `text-alignment` | All 3 alignments × 3 valign options = 9 combinations |
| `rotated-text` | Text at various angles, transform matrix |
| `svg-layer` | Layer with `:svg` annotation, named elements, opacity |
| `png-layer` | Layer with `:png` annotation, transparent overlay |
| `symbol-layer` | Rectangles, circles, lines as CSS divs |
| `div-layer` | Scaled symbols (percentage-based) |
| `video-layer` | Video URL text frame |
| `custom-blocks` | CSS, JS, HTML injection blocks |
| `area-text-styled` | Area text with background fill and border |
| `style-dedup` | Many text frames with shared/varied styles |
| `nested-opacity` | Elements with opacity through parent chain |
| `dynamic-responsiveness` | Artboards with `responsiveness: dynamic` |
| `fixed-responsiveness` | Artboards with `responsiveness: fixed` |
| `mixed-responsiveness` | Mix of fixed and dynamic artboards |
| `artboard-name-settings` | Artboard names with `:600`, `:dynamic`, `:image_only` |
| `excluded-artboard` | Artboard starting with `-` (should be skipped) |
| `empty-paragraphs` | Text with blank lines (`&nbsp;`) |
| `character-styles` | Bold, italic, color, tracking, super/subscript within one paragraph |
| `point-text-overflow` | Point text with extra width padding |
| `color-snapping` | Near-black colors that should snap to pure black |
| `multiple-files-output` | Different artboard names → separate HTML files |
| `clickable-link` | Entire graphic wrapped in `<a>` tag |
| `alt-text` | Accessibility: alt text, aria role |
| `html-entities` | Special characters: &, <, >, accented chars, symbols |
| `snippet-layer` | `:snippet` layer with positioned rectangles, multiple keys |
| `snippet-multi-artboard` | Same snippet key across responsive artboards, key stability |
| `tagged-text` | `:text` and `:htext` layers with named text frames, binding paths |
| `tagged-text-key-stability` | Renamed objects, auto-generated IDs, key determinism |
| `tagged-text-html-injection` | `:htext` with HTML content, escaping boundary test |
| `css-var-images` | Multi-artboard with container queries, CSS custom property image loading |
| `aspect-ratio-shim` | Artboard with both `aspect-ratio` and padding-bottom shim |

---

## 8. CLI Interface

```bash
# Basic usage: process IR and output HTML
all2html render ir.json -o output/

# Specify output format
all2html render ir.json -o output/ --format html
all2html render ir.json -o output/ --format svelte
all2html render ir.json -o output/ --format react
all2html render ir.json -o output/ --format standalone

# With config file
all2html render ir.json -o output/ --config all2html.config.json

# Validate IR without rendering
all2html validate ir.json

# Watch mode (re-render on IR file change)
all2html watch ir.json -o output/
```

---

## 9. Feature Parity Checklist

Every ai2html feature, mapped to our implementation:

### Settings (40+)
| ai2html Setting | Status | Notes |
|---|---|---|
| `namespace` | Implement | CSS class prefix |
| `image_format` | Implement | auto/png/png24/jpg/svg |
| `write_image_files` | Implement | Exporter handles this |
| `responsiveness` | Implement | fixed/dynamic |
| `text_responsiveness` | Implement | Area text width: % vs px |
| `output` | Implement | one-file / multiple-files |
| `html_output_path` | Implement | |
| `image_output_path` | Implement | |
| `image_source_path` | Implement | Path prefix for img src |
| `png_transparent` | Implement | Exporter setting |
| `png_number_of_colors` | Implement | Exporter setting |
| `jpg_quality` | Implement | Exporter setting |
| `use_2x_images_if_possible` | Implement | Exporter: export at 2x |
| `cache_bust_token` | Implement | Core: append ?v= to URLs |
| `render_text_as` | Implement | html/image |
| `render_rotated_skewed_text_as` | Implement | html/image |
| `testing_mode` | Implement | Red overlay for debugging |
| `center_html_output` | Implement | margin: 0 auto |
| `max_width` | Implement | Container max-width |
| `include_resizer_css` | Implement | Container queries |
| `include_resizer_widths` | Implement | data-min/max-width attrs |
| `include_resizer_script` | Skip | Legacy JS resizer — modern only |
| `use_lazy_loader` | Implement | Native loading="lazy" only |
| `inline_svg` | Implement | |
| `svg_id_prefix` | Implement | |
| `svg_embed_images` | Implement | Exporter setting |
| `clickable_link` | Implement | Wrap in `<a>` |
| `create_promo_image` | Implement | Exporter generates |
| `promo_image_width` | Implement | Exporter setting |
| `local_preview_template` | Implement | Template rendering |
| `headline/leadin/summary/notes/sources/credit` | Implement | Metadata |
| `alt_text` | Implement | Accessible hidden div |
| `image_alt_text` | Implement | img alt attr |
| `aria_role` | Implement | Container role attr |
| `create_config_file` | Skip | NYT-specific |
| `create_settings_block` | Exporter | Exporter creates settings block |
| `show_completion_dialog_box` | Exporter | Exporter UI |
| NYT-specific settings | Skip | Not relevant outside NYT |

### Layer Types
| Layer Type | Status | Notes |
|---|---|---|
| `:svg` | Implement | Export as SVG, inline option |
| `:png` | Implement | Export as transparent PNG overlay |
| `:symbol` | Implement | Shapes → fixed CSS divs |
| `:div` | Implement | Shapes → scaled CSS divs |
| `:video` | Implement | Video embed |
| `:html-before` | Implement | Raw HTML injection |
| `:html-after` | Implement | Raw HTML injection |
| `:snippet` | Implement (v1.1) | Shapes → SnippetElements (mount regions for interactive content) |
| `:text` | Implement (v1.2) | Text frames → TextElement with `binding` (overridable at runtime) |
| `:htext` | Implement (v1.2) | Text frames → TextElement with `binding.allowHtml: true` (raw HTML) |

### Text Features
| Feature | Status | Notes |
|---|---|---|
| Point text | Implement | Extra width, nowrap, pixel width |
| Area text | Implement | Percentage width (dynamic), pixel (fixed) |
| Paragraph styles | Implement | Dedup with g-pstyle{N} |
| Character styles | Implement | Dedup with g-cstyle{N} |
| Text alignment (L/C/R/J) | Implement | Anchor point positioning |
| Vertical alignment | Implement | top/middle/bottom via note attr |
| Rotated text | Implement | CSS transform matrix |
| Font mapping | Implement | Config + weight guessing heuristic |
| Font vshift | Implement | Point text vertical compensation |
| Color snapping | Implement | Near-black → pure black |
| Empty paragraphs | Implement | `&nbsp;` |
| Superscript/subscript | Implement | vertical-align + 0.7× font size |
| Tracking → letter-spacing | Implement | tracking/1000 em |
| Leading → line-height | Implement | px |
| Area text path styling | Implement | background-color, border |
| HTML entities | Implement | 130+ character replacements |
| Curly quote straightening | Exporter | In code blocks |
| HTML tag detection/warning | Implement | Warn on `<i>`, `<span>`, etc. |

### ai2svelte-Derived Features
| Feature | Status | Version | Notes |
|---|---|---|---|
| CSS custom property image loading | Implement | v1 | Core CSS generation: `--img` vars in container queries |
| `aspect-ratio` on artboard divs | Implement | v1 | Alongside padding shim for fallback |
| `%%ASSET_PATH%%` token in CSS | Implement | v1 | Core generates; emitters replace with static path or runtime prop |
| `assetsPath` prop (Svelte/React) | Implement | v1 | Runtime base path for images |
| `onMounted` callback | Implement | v1 | Component lifecycle hook |
| SnippetElement in IR schema | Implement | v1 | Schema only; emitters render as empty divs in v1 |
| TextElement.binding in IR schema | Implement | v1 | Schema only; emitters ignore in v1 |
| Snippet rendering (Svelte) | Implement | v1.1 | `{@render key?.()}` |
| Snippet rendering (React) | Implement | v1.1 | `ReactNode` props |
| Tagged text overrides (Svelte) | Implement | v1.2 | `taggedText.path` expressions |
| Tagged text overrides (React) | Implement | v1.2 | Optional chaining on `taggedText` prop |
| `onArtboardChange` callback | Implement | v1.2 | Width-based artboard detection |
| Wildcard/sequence export | Defer | — | CLI orchestration, not core. Revisit when base pipeline is stable. |
| CEP panel UI | Skip | — | Out of scope. Our config lives in files + CLI. |
| XMP metadata persistence | Skip | — | Tied to CEP panel. Settings live in text blocks + config files. |
| Profile system | Skip | — | Config files cover this use case. |
| Shadow/animation presets | Skip | — | Reuters-specific editorial tooling, not general-purpose. |

### Edge Cases
| Edge Case | Status | Notes |
|---|---|---|
| Clipping mask detection | Exporter | Menu command approach |
| Locked object handling | Exporter | Unlock → process → relock |
| MRAP workaround | Exporter | Named function wrapper |
| Isolation mode detection | Exporter | Error on "Isolation Mode" layer |
| Opacity mask detection | Exporter | Error on `<Opacity Mask>` layer |
| Document state preservation | Exporter | Restore saved state |
| Artboard name ` copy` suffix | Exporter | Strip before parsing |
| Cache bust auto-increment | Exporter | Increment in settings block |
| SVG opacity/multiply workaround | Exporter | Name encoding trick |
| SVG id cleanup + data-name | Core | Post-process SVG |
| SVG non-scaling-stroke | Core | Inject CSS rule |
| SVG raster image removal | Exporter | Remove `<image>` elements |
| Point text Chrome zoom fix | Core | height = line-height |
| Config file `//` comments | Core | Strip before JSON parse |

---

## 10. Implementation Phases

### Phase 1: Foundation
- [ ] Project scaffolding (package.json, tsconfig, vitest)
- [ ] IR schema types (`src/ir/schema.ts`)
- [ ] Zod validation (`src/ir/validate.ts`)
- [ ] Hand-craft 5 basic IR fixtures
- [ ] `loadAndValidateIR` with tests

### Phase 2: Core Pipeline (text only)
- [ ] `resolveSettings` — settings merge chain
- [ ] `computeBreakpoints` — artboard visibility ranges
- [ ] `computeStyles` — AI style → CSS conversion
- [ ] `fontMap` — font lookup + weight guessing
- [ ] `deduplicateStyles` — base selection, class assignment
- [ ] `computePositions` — absolute → percentage
- [ ] Unit tests for each transform

### Phase 3: HTML Emitter
- [ ] hast tree construction for single artboard
- [ ] CSS generation (container, artboard, text styles)
- [ ] Multi-artboard responsive (container queries)
- [ ] Custom block injection (CSS, JS, HTML)
- [ ] Accessibility (alt text, aria role)
- [ ] Clickable link wrapper
- [ ] Snapshot tests against golden HTML

### Phase 4: ExtendScript Exporter
- [ ] Document validation
- [ ] Settings block parsing
- [ ] Artboard enumeration + name parsing
- [ ] Layer structure extraction
- [ ] Text frame extraction (point + area)
- [ ] Character style extraction
- [ ] Clipping mask detection
- [ ] Image export (artboard backgrounds)
- [ ] IR JSON output
- [ ] Test against sample .ai files

### Phase 5: Advanced Features
- [ ] SVG layer export + inline SVG
- [ ] PNG layer export
- [ ] Symbol/div layer (shapes → CSS)
- [ ] Video layer
- [ ] Rotated text (transform matrix)
- [ ] `image_only` artboards
- [ ] Dynamic responsiveness (`aspect-ratio` + padding shim)
- [ ] `multiple-files` output mode
- [ ] Promo image generation
- [ ] Template system (Mustache/EJS)
- [ ] Cache bust token
- [ ] CSS custom property image loading (container query optimization)
- [ ] `%%ASSET_PATH%%` token generation in shared CSS

### Phase 6: Visual Regression
- [ ] Playwright test infrastructure
- [ ] Screenshot tests at multiple widths
- [ ] Create .ai test files in Illustrator
- [ ] Run ai2html on test files → commit reference output
- [ ] Run our pipeline on same files → compare screenshots

### Phase 7: Component Emitters (v1)
- [ ] Svelte emitter — static component shell
  - [ ] `assetsPath` prop + `%%ASSET_PATH%%` replacement
  - [ ] `onMounted` callback
  - [ ] CSS scoped via `#id` (not Svelte scoping)
  - [ ] Container queries (same CSS as HTML emitter)
  - [ ] SnippetElement → empty positioned divs (placeholder)
  - [ ] TextElement.binding → static text (ignored in v1)
- [ ] React emitter — static component shell
  - [ ] Same feature set as Svelte (parallel implementation)
  - [ ] `emit.react.typescript` option (.tsx generation)
- [ ] Standalone HTML emitter
- [ ] Emitter option loading from config file `emit` section

### Phase 8: CLI + Polish
- [ ] CLI with argument parsing
- [ ] `--emit-options` flag or config file `emit` section
- [ ] Watch mode
- [ ] Error messages and warnings matching ai2html's
- [ ] Documentation

### Phase 9: Snippets (v1.1)
- [ ] Svelte: `{@render key?.()}` inside positioned wrapper divs
- [ ] React: `ReactNode` prop rendering inside positioned wrapper divs
- [ ] Exporter: `:snippet` layer detection → SnippetElement creation
- [ ] Stable key generation + warnings for auto-generated keys
- [ ] Test fixtures: `snippet-layer`, `snippet-multi-artboard`

### Phase 10: Tagged Text (v1.2)
- [ ] Svelte: `taggedText.path` expressions, `{@html}` for allowHtml
- [ ] React: optional chaining expressions, `dangerouslySetInnerHTML`
- [ ] `onArtboardChange` callback (both emitters)
- [ ] Exporter: `:text`/`:htext` layer detection → TextElement.binding
- [ ] Stable path generation from layer name + object name
- [ ] Security documentation for `allowHtml`
- [ ] Test fixtures: `tagged-text`, `tagged-text-key-stability`, `tagged-text-html-injection`

### Phase 11: Advanced Emitter Features (future)
- [ ] Evaluate fit/overflow semantics against real component use cases before reintroducing them publicly
- [ ] Revisit Svelte preload behavior once there is a concrete asset-loading strategy to optimize

---

## 11. Open Questions (to resolve during implementation)

1. **CSS namespace collision prevention**: Should we hash the slug to ensure uniqueness, or rely on the document name being unique?
2. **Asset manifest hashing**: Should the core rename images to content-hashed filenames, or keep the exporter's names?
3. **Web UI**: Drag-and-drop IR processing interface — separate project or part of this repo?
4. **Batch processing**: Should the CLI support processing multiple IR files at once?
5. **Print styles**: CSS custom properties + container queries may behave differently in print. ai2html has `media="screen,print"` on styles. Do we need print-specific fallbacks?
6. **`prefers-reduced-data`**: Should the CSS custom property approach skip image loading when the user has opted for reduced data?
7. **Component emitter responsive fallback**: For environments without container query support (email, old webviews), should component emitters offer a JS-driven fallback mode?

### Resolved Questions

> **Svelte CSS scoping**: Should the Svelte emitter use Svelte's built-in scoping (`:global()` modifiers), or keep our own `#id`-based scoping?
>
> **Decision**: Keep `#id`-based scoping. This is consistent across all emitters, avoids framework-specific scoping quirks, and works the same whether the component is SSR'd or client-rendered.

> **Layer types for snippets/tagged text**: Should `:snippet`, `:text`, `:htext` be new Layer types?
>
> **Decision**: No. `Layer.type` represents export/rendering strategy. Snippets and tagged text are API annotations expressed on elements (`SnippetElement`, `TextElement.binding`). Layers containing these elements have `type: "default"`. This keeps core transforms from needing to special-case layer types that are really consumer-facing API metadata.

> **Emitter-specific options**: In Settings or separate?
>
> **Decision**: Separate `emit` section in config file. Settings are exporter-generated and tool-agnostic. Emitter options are render-target concerns. The core pipeline ignores `emit`; each emitter reads its own section.

## Appendix A: Determinism Contract

For reproducible output and reliable testing:

| Property | Rule |
|---|---|
| CSS property order | Alphabetical within each rule |
| CSS class naming | `g-pstyle{N}` by descending frequency, then alphabetical key |
| Element ordering | Artboards by width ascending; elements by position (top→bottom, left→right) |
| Numeric precision | 4 decimal places for percentages and em values |
| Color format | `rgb(r,g,b)` for opaque, `rgba(r,g,b,a)` when opacity < 100% |
| Color snapping | RGB all < 36 → rgb(0,0,0) |
| Asset naming | `{slug}-{artboard}.{ext}` (exporter), stable across runs |
| Snippet keys | From layer name prefix (stable if layer is named); sanitized to valid JS identifiers |
| Binding paths | `{layerPrefix}.{objectName}` — stable if objects are named; warn on auto-generated |
| CSS custom property names | `--{slug}-{artboard}-img` — deterministic from slug + artboard name |

## Appendix B: ai2html Features Explicitly Skipped

| Feature | Reason |
|---|---|
| Legacy JS resizer script | Modern container queries only |
| NYT environment detection | Not relevant outside NYT |
| NYT-specific settings (Scoop, Birdkit, Preview) | Not relevant |
| config.yml output | NYT CMS integration |
| `show_completion_dialog_box` | Exporter UI, not core |
| ExtendScript `ScriptUI` progress bar | Exporter UI |
| Git config reading for slug | NYT-specific |

## Appendix C: ai2svelte Features Explicitly Skipped

| Feature | Reason |
|---|---|
| CEP panel UI | Our config lives in files + CLI. The IR boundary makes a panel optional (settings GUI + "run" button). |
| XMP metadata persistence | Tied to CEP panel. Our settings live in text blocks + config files. |
| Profile system | Config files (`all2html.config.json`) cover this use case. |
| Shadow/animation presets (29 shadows, 20 animations) | Reuters-specific editorial tooling, not general-purpose. Consumers apply their own CSS. |
| SCSS output (`<style lang="scss">`) | We emit plain CSS. Consumers post-process with their own tooling. |
| Wildcard/sequence export (`{start,count}`) | CLI orchestration, not core architecture. If needed, the exporter produces multiple IR files. |
| `@tsparticles/confetti` | No. |

## Appendix D: ai2svelte Features Absorbed

Features from ai2svelte (Reuters' fork of ai2html) incorporated into this spec. See `research/ai2svelte-feature-spec.md` for the full analysis.

| Feature | ai2svelte Implementation | all2html Approach | Version |
|---|---|---|---|
| Svelte output | Monolithic ExtendScript generates `.svelte` | Core pipeline → Svelte emitter (IR boundary) | v1 |
| CSS custom property images | `style:--img` bindings on container | `%%ASSET_PATH%%` token in shared CSS, emitter replaces | v1 |
| `aspect-ratio` on artboards | Inline style | Inline style + padding shim fallback | v1 |
| `assetsPath` prop | Svelte prop + `$derived` normalization | Emitter prop, runtime path interpolation | v1 |
| Snippet system (`:snippet` layers) | ExtendScript → `{@render}` | `SnippetElement` in IR → emitter renders | v1.1 |
| Tagged text (`:text`/`:htext` layers) | ExtendScript → Svelte expressions | `TextElement.binding` in IR → emitter renders | v1.2 |
| `onArtboardChange` callback | `$effect` watching `aiBoxWidth` | Emitter-specific callback prop | v1.2 |
| Fit modes (height/cover) | CSS in ExtendScript | Emitter option with precedence rules | v2 |
| Priority fetch | `<svelte:head>` preload links | Svelte emitter option | v2 |
| External font config | CEP panel `fontsConfig` object | Config file `fonts` array (already in spec) | v1 |
