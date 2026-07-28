# all2html — Technical Specification

> **How to read this document.** This is the **target** design — what the system should be. It is not a description of current behavior, and it is not a record of what has been built.
>
> - For what is actually built and working: **`PROGRESS.md`**.
> - For which settings and features each surface actually honors: **`internal-docs/capability-matrix.md`**.
> - For rules that must not be violated again: the **Contract Rules** section of `CLAUDE.md`.
>
> Where this spec and the implementation disagree, **neither automatically wins**. The implementation is evidence about what the design costs in practice; the spec is evidence about what we intended. §11 records one case where the implementation refuted a spec decision outright.

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

- **v1.1 — Snippets**: SnippetElement support in Svelte/React emitters (interactive component placeholders). IR types and `shared/replaceable-nodes.ts` exist; no emitter imports them, so the emitted `data-replaceable` attributes are currently inert.
- **v1.2 — Tagged text**: Binding-based text overrides in Svelte/React emitters. Same status — `data-binding-path` is emitted but nothing consumes it.
- **v2 — Artboard change events**: `onArtboardChange` callback in component emitters

**Shipped since this list was written** (do not re-plan): `positionMode: 'percentage' | 'absolute'` (`src/emitters/shared/percentage-positions.ts`) and CSS custom property image loading (`src/emitters/shared/css.ts`).

### Non-Goals (v1)

- RTL / complex scripts / vertical text
- Copy-editable output
- Image bandwidth optimization (`<picture>` tags, lazy loading non-visible artboards)
- IR versioning (pre-release)
- A hardened, user-facing Figma or After Effects exporter in v1
- Profile system, shadow/animation presets (see ai2svelte analysis in `research/`)

> **Superseded.** This list originally also excluded "CEP panel UI, XMP metadata persistence." Both were subsequently built and are now among the largest subsystems in the repo (`plugins/illustrator/panel/`, Bolt CEP + Svelte 5, serving both Illustrator and After Effects). The scope decision changed; this line did not. Treat the panel as in-scope.

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

### 2.3 Output Generation — a node tree plus one serializer

**STATUS: SUPERSEDED by §12.6 (shipped).** This section originally specified `hast` from the unified ecosystem as the runtime tree and `hast-util-to-html` as the serializer. That is not what ships: `hast` cannot enter the ExtendScript bundle, so the emitters build their own serializable node tree (`src/emitters/html-tree.ts`) over an ES3-safe serializer (`src/emitters/shared/html-node.ts`), and `hast-util-to-html`/`hastscript` are devDependencies used only by tests. `hast-util-to-jsx-runtime` was never adopted at all.

What survives from the original intent:
- Type-safe tree construction
- Escaping owned by the serializer, not by call sites (`src/emitters/shared/escape.ts`)
- Deterministic output — attributes are an ordered array of pairs, not object-key order
- Custom code blocks quarantined as explicit raw nodes

`src/emitters/shared/to-hast.ts` converts the node tree *to* hast for rehype-based post-processing, and `test/unit/html-serializer.test.ts` renders every fixture through both paths and asserts byte equality — which is what keeps the escaping contract pinned to hast's own.

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
│   │   ├── html-tree.ts            # HTML node-tree builder (the one HTML emitter)
│   │   ├── html.ts                 # re-export entry point
│   │   ├── html-string.ts          # re-export entry point (ExtendScript bundle)
│   │   ├── svelte.ts               # Svelte component emitter
│   │   ├── react.ts                # React component emitter
│   │   ├── standalone.ts           # Full standalone HTML page
│   │   ├── types.ts                # EmitterOptions, emitter contract types
│   │   └── shared/
│   │       ├── css.ts              # CSS generation (shared across emitters)
│   │       ├── html-node.ts        # ES3-safe node tree + serializer
│   │       ├── escape.ts           # the four escaping grammars, single-sourced
│   │       ├── to-hast.ts          # node tree → hast, for rehype post-processing
│   │       └── assets.ts           # asset path resolution + %%ASSET_PATH%% token
│   └── cli/
│       └── index.ts                # CLI entry point
├── plugins/
│   └── illustrator/
│       ├── exporter.jsx            # ExtendScript exporter
│       └── README.md
├── test/
│   ├── fixtures/
│   │   ├── ir/                     # hand-crafted IR JSON files
│   │   ├── golden/                 # expected output snapshots
│   │   │   ├── html/
│   │   │   └── screenshots/
│   │   ├── ai-files/               # actual .ai test files
│   │   └── ai2html-reference/      # ai2html output for same files (planned; not created)
│   ├── unit/                       # per-transform tests
│   ├── integration/                # full pipeline tests
│   └── visual/                     # Playwright screenshot tests
└── research/                       # ai2html analysis, transcripts, specs
```

**Boundary enforcement:** TypeScript path aliases and barrel exports. `plugins/illustrator/` must not import from `src/core/` — it only depends on the IR schema types. The public API is `src/index.ts`.

---

## 3. Intermediate Representation (IR) Schema

**STATUS: RECONCILED with the shipped IR, not superseded.** This section was edited to match `src/ir/types.ts` / `src/ir/schema.ts` — `generator` became the `source` envelope, `irVersion` was added, and the `settings` block was brought in line with `SETTING_DEFINITIONS`. Unlike §2.3, nothing here was overtaken by a different design: the canonical IR is still the target, so the shipped shape and the specced shape are meant to be the same document. The rest of this file remains aspirational; when this section and the code disagree, the code is the contract and this section is the bug. `PROGRESS.md` records what is actually built.

### 3.1 Document

```typescript
interface Document {
  irVersion: string;        // IR schema version, currently "0.1.0" (pre-release)

  source: {
    tool: string;           // "illustrator", "figma", "svg", etc.
    toolVersion?: string;   // "29.0"
    adapterVersion?: string; // version of the exporter/adapter that produced this IR
    id?: string;            // source-native document/node identifier
    name?: string;          // source-native display name
    [key: string]: JsonValue | undefined; // arbitrary source metadata
  };

  settings: Partial<Settings>;
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

**CSS**: Uses `<style>` with `#id`-based scoping (same as HTML emitter), wrapped in Svelte's `:global { … }` — Svelte cannot see inside `{@html}` and would otherwise prune every selector (see §11). All CSS is generated by the shared CSS module. No SCSS dependency — if consumers want SCSS, they post-process.

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

## 10. Implementation Status

This section previously held a phase-by-phase build plan with ~70 unchecked task boxes. Every one of phases 1-8 has since shipped, so the checklist had become actively misleading — it read as "nothing is built."

**Build status now lives in `PROGRESS.md`.** Per-surface feature and settings support lives in `internal-docs/capability-matrix.md`. Do not reintroduce a task checklist here; a spec that doubles as a project tracker goes stale in exactly this way.

What remains genuinely unbuilt is listed under "v1.1+ Roadmap" in §1 and "Deferred" in `PROGRESS.md`.

---


## 11. Open Questions (to resolve during implementation)

1. **CSS namespace collision prevention**: Should we hash the slug to ensure uniqueness, or rely on the document name being unique? — *Now urgent, not hypothetical: container ids are slug-prefixed but text element ids are not (`g-ai0-1`), so two graphics on one page collide. `metadata.slug` is also unvalidated (`MetadataSchema.slug` in `schema.ts` is only `min(1)`, not a CSS-identifier check) while flowing into CSS selectors and `container-name`.*
2. **Asset manifest hashing**: Should the core rename images to content-hashed filenames, or keep the exporter's names?
3. ~~**Web UI**: Drag-and-drop IR processing interface — separate project or part of this repo?~~ **Resolved: part of this repo** — `apps/svg-dropzone` is a workspace package backed by `src/browser.ts`.
4. **Batch processing**: Should the CLI support processing multiple IR files at once?
5. **Print styles**: CSS custom properties + container queries may behave differently in print. ai2html has `media="screen,print"` on styles. Do we need print-specific fallbacks?
6. **`prefers-reduced-data`**: Should the CSS custom property approach skip image loading when the user has opted for reduced data?
7. **Component emitter responsive fallback**: For environments without container query support (email, old webviews), should component emitters offer a JS-driven fallback mode?

### Resolved Questions

> **Svelte CSS scoping**: Should the Svelte emitter use Svelte's built-in scoping (`:global()` modifiers), or keep our own `#id`-based scoping?
>
> **Original decision**: Keep `#id`-based scoping. Consistent across emitters, avoids framework-specific quirks, works the same SSR'd or client-rendered.
>
> **REVERSED — this decision was wrong and shipped a broken emitter.** The reasoning ignored that the markup goes out through `{@html}` in `svelte.ts`. Svelte's compiler cannot see inside `{@html}`, so it prunes every `#id` selector as unused. Compiling the emitted component against Svelte 5 produces `css_unused_selector` for every rule and comments out the entire stylesheet, including the `@container` breakpoint rules. The output is unstyled absolutely-positioned text.
>
> **Correct decision**: wrap the emitted stylesheet in Svelte's `:global { … }` block. The `#id` scoping *strategy* is still right — it is what keeps output namespaced — but Svelte must be told not to scope it a second time. The general lesson: a decision about a framework's semantics is not resolved until something compiles the output. **STATUS: DONE** — the emitted stylesheet is wrapped in `:global { … }`, `svelte` is a devDependency, and `test/unit/svelte-emitter-compile.test.ts` compiles the output against Svelte 5 and asserts zero `css_unused_selector` warnings.

> **Layer types for snippets/tagged text**: Should `:snippet`, `:text`, `:htext` be new Layer types?
>
> **Decision**: No. `Layer.type` represents export/rendering strategy. Snippets and tagged text are API annotations expressed on elements (`SnippetElement`, `TextElement.binding`). Layers containing these elements have `type: "default"`. This keeps core transforms from needing to special-case layer types that are really consumer-facing API metadata.

> **Emitter-specific options**: In Settings or separate?
>
> **Decision**: Separate `emit` section in config file. Settings are exporter-generated and tool-agnostic. Emitter options are render-target concerns. The core pipeline ignores `emit`; each emitter reads its own section.

## 12. Target Contract (redesign)

The current implementation is treated as **evidence**, not as a specification. This section records what the contract should look like if written from scratch today, informed by the specific ways the present one has failed.

**Order of work.** Capability declarations (§12.5) and structured warnings (§12.7) lead, because they depend on nothing else here and they are where all the *verified user harm* lives — settings that silently no-op. Then JSON purity (§12.2) and exclusive phase types (§12.1), which are local and mechanical. The envelope/scene split (§12.9) is deferred; §12.6 (one emitter) is a maintenance win, not a correctness one, and must not gate the parity fix — that bug's root cause is `escapeAttr` defined three times, which is a day's work to single-source.

An earlier draft chained everything behind the envelope split, which meant the user-visible lying persisted through the riskiest work. That was backwards.

### 12.1 Phase types must be exclusive, not additive

**STATUS: DONE** (D20). See the implementation note in D20 for what shipped.

**Evidence (pre-fix, retained as the reason the phase types exist).** The phase types did not enforce the pipeline. `settings-resolver.ts` fabricated a placeholder breakpoint (`minWidth: 0, maxWidth: Infinity`) purely so `ResolvedDocument` typechecked — meaning `computeBreakpoints` could be skipped entirely and produce silent garbage instead of a type error. `EmitterReadyLayer.elements` admitted both the emitter-ready variants *and* the raw ones, so "emitter-ready" guaranteed nothing; the cost was 10+ runtime property-sniffing guards scattered across the emitters and transforms. `compute-styles.ts` cast an image-rendered `TextElement` into the styled union rather than modelling it. All three are gone.

**Target.**
- Each phase type makes the previous phase's uncertainty *unrepresentable*. If a transform can be skipped without a type error, the phase type is decoration and should be deleted or fixed.
- **Use an explicit `pipelinePhase` literal discriminator, not additive fields.** TypeScript is structural: adding a field per phase does not stop a later document from being assignable to an earlier phase's parameter, which is exactly why `computeBreakpoints` can currently be called twice or never with no type error. Per-phase field types are selected by the literal; each transform's signature names the exact phase it consumes and produces.
- **Phase documents are internal.** The persisted canonical IR stays the validated source document — bundles already serialize the original IR (`output-bundle.ts#createOutputBundle`). Serializing intermediate phases would expand the long-term contract for no benefit.
- Add a distinct `BreakpointedDocument` phase so `breakpoint` simply does not exist before `computeBreakpoints` runs. Delete the placeholder.
- Model image-rendered text as its own element variant so no transform casts.
- Remove the raw variants from `EmitterReadyLayer`. Every runtime `"in"`-check that disappears is the measure of success.

### 12.2 The model is JSON, with no sentinels

**STATUS: DONE** (D21). `compute-breakpoints.ts` models the unbounded top artboard with `maxWidth: undefined`, `assertJsonPure()` runs at five boundaries on the shared path and two on the ExtendScript path, and `assertUsableArtboardDimensions()` closes the stringified-divisor class.

**Evidence (pre-fix).** `compute-breakpoints.ts` stored `Infinity`, which `JSON.stringify` turns into `null`; the emitters' `bp.widthRangeMax < Infinity` guard then passes and emits `max-width:nullpx`. Latent only because nothing currently serializes a post-breakpoint document — the Figma bridge, a worker, or an IR cache would all trigger it.

**Target.** Absence is modelled by absence (`maxWidth?: number`), never by a sentinel. The document model round-trips through JSON unchanged, and a test asserts exactly that.

The rule binds consumers too, not just the model: `extractBreakpointData()` carries the absent `maxWidth` through as absent (`isBreakpointActive()` treats it as unbounded) rather than substituting a large number. A `99999` at the consumer is the same defect relocated — it is a real upper bound to anything doing `minWidth <= w <= maxWidth`, so a 120000px artboard or a 100000px container matches no entry.

**Where the invariant is enforced.** Runtime assertions (`src/core/json-purity.ts`) cover five transform boundaries on the Node/browser path and two — entry and exit — on the ExtendScript path. `groupArtboards` is not asserted anywhere; it coins no numbers. The reduced ExtendScript coverage is a measured cost tradeoff, not an assumption that the path is covered elsewhere: see decision D21 for the numbers and for the earlier version of this claim, which asserted nothing at all inside ExtendScript while implying full coverage.

**What the assertions do not cover, at any boundary count.** The walk tests `typeof === "number"`, so a sentinel that is divided and stringified in one expression is already a string by the next boundary. `compute-positions.ts` writes `${round((pos.x / artboardWidth) * 100)}%`; a zero-width artboard therefore emitted `left: Infinity%` with both gates green and no warning. Five boundaries would not have caught it either. Non-finite *intermediates* are prevented at the input instead: Zod (`ArtboardSchema.width`/`height` are `.positive()`) on the shared path, and `assertUsableArtboardDimensions` (`src/core/artboard-dimensions.ts`) on the ExtendScript path, which runs no Zod. Artboard width and height are the only divisors in the ExtendScript-bound transforms; a new divisor needs the same input guard, because a purity assertion cannot substitute for one.

### 12.3 One settings table, derived everywhere

**Evidence.** `settings-definitions.ts` is already the single source for defaults and the Zod schema — this is the best-designed part of the codebase and the target extends it rather than replacing it. But everything else restates it: the panel maintains its own key map and labels, both ExtendScript exporters carry their own snake_case parsers with *different defaults* (`use_2x_images_if_possible` defaults `true` in one path and `undefined` in the other), and the docs table is hand-maintained. Adding one setting currently touches ~19 non-test files.

**Target.** The definition table also drives the snake_case compatibility mapping, the panel controls and their labels/help, and the generated settings documentation. Adding a setting touches one file plus the code that acts on it.

### 12.4 Settings resolve exactly once, in the core

**Evidence.** Precedence is implemented three times with different layer counts — panel 5 (`panel/src/js/persistence.ts#resolveSettingsLayers`), Illustrator 3 (`illustrator/exporter.jsx#loadConfigFiles`), After Effects 3 (`ae-persistence.ts#resolveAeStateLayers`) — and the panel pre-merges its layers before handing them over, so the exporter's documented order is only accidentally correct.

**Target.** Surfaces contribute *unmerged, labelled layers*; the core resolves and returns both the resolved value and its provenance. The panel sends only the keys the user actually edited. Provenance becomes a core output rather than a thing the UI reconstructs, which also collapses the five-badge display into what a user needs: locked, and changed.

### 12.5 Surfaces declare capabilities; unsupported settings warn

**Evidence.** This is the single largest source of user-visible wrongness. `output: multiple-files` is a no-op on Illustrator (`groupArtboards` is never called from `src/extendscript/index.ts`). `imageFormat: svg`/`png24` silently produce PNG8. The Figma UI offers five image formats and always exports PNG at 1x. In every case the export *succeeds* and the user gets no signal.

**Target.** Each surface declares the settings and features it honors. The core validates the resolved settings against the active surface's declaration and warns on anything unhonored. `internal-docs/capability-matrix.md` and the public support matrix are generated from those declarations, so documentation cannot drift from behavior. A UI must not render a control for a capability its surface does not declare.

### 12.6 One HTML emitter

**Evidence.** `html.ts` and `html-string.ts` are ~1050 lines with an identical function decomposition and 100% duplicated logic, differing only in hast-vs-string idiom, kept in sync by a test that cannot see the divergence class that actually occurs. They disagree today on four fields because hast's escaping subset differs from `escapeHtml`'s. `escapeAttr` is defined four times across the repo.

**Target.** One emitter builds a serializable node tree of plain objects — which the JSON-serializable rule already requires — and one ES5-safe serializer renders it. Nothing downstream consumes hast; only its string output is used. The escaping contract becomes single-sourced, which retires the parity bug *by construction* rather than by test. A hast adapter can remain for consumers who want the tree.

> **STATUS: DONE for HTML.** `emitters/html-tree.ts` builds the tree, `emitters/shared/html-node.ts` defines the nodes and holds the one ES3-safe serializer, and `html.ts` / `html-string.ts` are re-export entry points onto the same function. Output is byte-identical to both former emitters, verified against verbatim copies of each across every IR fixture × the full option cross-product × grouped/ungrouped before those copies were deleted. Attributes are an ordered array of pairs rather than an object, because ES3 does not define `for...in` order and the old string emitter's `Object.keys` iteration was therefore unspecified inside ExtendScript. `shared/to-hast.ts` keeps the rehype seam and doubles as the parity anchor that pins the escaping subsets to `hast-util-to-html`'s own. Cost: +788 B in both ExtendScript artifacts (this bundle only ever carried one of the two emitters, with builder and serializer fused, so there was no duplication here to delete); −239 lines repo-wide.
>
> **STATUS: DONE for Svelte and React.** Both now consume `buildHTMLTree()` through `emitters/shared/component-tree.ts`, which is what turns `buildHTMLTree()` from an exported convenience into the actual shared input. Three regexes retired: the `<style>` block is *removed from the tree as a node* rather than matched out of a string; the Google Fonts `<link>` tags are never built (the tree is built with `googleFonts: "none"` and the href is carried out separately to `<svelte:head>` / JSX, so `stripGoogleFontsLinkTags` has no caller in the emitters); and `/<!--[\s\S]*?-->/g` is gone, which stops the emitters eating comments an author wrote inside their own `html-before` / `html-after` blocks. Zero bytes in either ExtendScript artifact — neither emitter is in that entry graph.
>
> **`data-replaceable` is no longer inert.** `emitters/shared/replaceable-nodes.ts` — written for this and imported by neither emitter — now finds snippet and binding placeholders *structurally in the tree* and splits it at them (`segmentTree`). Only the ancestor spine down to a placeholder is reconstructed as real framework markup; every subtree with no placeholder inside stays one opaque `{@html}` / `dangerouslySetInnerHTML` chunk, which keeps author HTML and inline SVG away from the framework compilers and leaves the no-snippet case at exactly one chunk. Snippets become **Svelte 5 snippet props** (`{@render key?.()}`) and **React `ReactNode` props**; bound text becomes a `bindings` prop keyed by path, with the design-file text as the fallback branch and the original paragraph class re-applied so replacing the text does not drop its type styles. Prop names are derived through `emitters/shared/js-identifier.ts`, which is total: a key is sanitized to an identifier, kept clear of every JS/TS reserved word *and* of every identifier the emitters generate themselves, and made unique within the document, deterministically. Any key whose prop name had to change warns (`emit:snippet-prop-renamed`) naming the layer and the chosen name, instead of emitting a component that does not compile (`default`), silently shadows a generated binding (`cssText`, `resolveHtml`), or renders one snippet in two places. Layer names and binding paths are emitted as **string literals in a data position** (`snippetKeys` / `bindingPaths`), never inside a comment — `JSON.stringify` escapes neither `*/` nor a newline in a `//` comment, which made a layer name a code-execution vector in the desk's own build.
>
> **Full JSX generation was considered and refused as a separate project.** React's static markup is still injected, not converted. What a real JSX emitter would need, none of which is in this change: (1) **an HTML parser for `raw` nodes** — custom blocks, html-hook layers and inline SVG are arbitrary author markup that the ES3-safe tree deliberately does not parse, and inline SVG additionally needs the SVG attribute set camelCased (`stroke-width` → `strokeWidth`), so this pulls a parser into a path that currently has none; (2) **a complete HTML→JSX attribute table**, not the handful of names the spine needs today; (3) **`&nbsp;` and other entity `raw` nodes resolved to characters**, since JSX has no entity syntax; (4) **a golden corpus**, because unlike the HTML collapse there is no byte-identical target to verify against — the output is new by construction. Converting only the nodes we build and leaving `raw` as innerHTML would put two escaping models in one file, which is the defect class §12.6 exists to remove. The spine conversion that did ship is the reusable half of that work: `styleObjectLiteral`, the attribute mapping and the segmenter are what a full emitter would build on.

### 12.7 Warnings are structured

**STATUS: DONE.** `src/core/warnings.ts` now groups by a `category` assigned at the call site, in the fixed `WARNING_CATEGORY_ORDER`, and never inspects message text; `src/cli/index.ts` calls `formatGroupedWarnings(groupWarnings(...))` from its five report sites. `test/unit/illustrator-warning-plumbing.test.ts` asserts `plugins/illustrator/exporter.jsx` no longer defines its own `groupWarnings`.

**Evidence (pre-fix).** `warnings.ts` classified warnings by substring-matching English prose (`w.includes("font")`), so "no fill color" landed in `other`. The core's grouping was dead code while a hand-copied ES5 fork in `exporter.jsx` was what users saw — and it only ran in automated mode, so the interactive user got a list truncated at 10 with no way to see the rest.

**Target.** Warnings carry a stable code and category assigned at the call site, plus the artboard/layer/element they concern. Grouping, truncation, and presentation are then presentation decisions, and every surface can render them well.

### 12.8 Surfaces load the core, or they are not surfaces

**Evidence (pre-fix).** The After Effects exporter never loaded the core bundle (`grep -c All2Html` → 0) and carried forked copies of the google-fonts helpers and escaping, which had already drifted. It generates CSS directly, which §2.1 assigns to the core.

**Target.** Any surface claiming to be part of this pipeline loads the shared bundle. Tool-agnostic logic is exported from an `src/extendscript/` bundle entry, never hand-copied. Both build scripts already concatenate string literals, so this costs one extra slot each.

**Status: half done, and the halves are separable.** The helper half shipped (D13): `build:after-effects` concatenates `dist/extendscript/all2html-ae-core.js` — ES5 polyfills plus `emitters/shared/escape.ts` and `emitters/shared/google-fonts.ts`, rolled up from `src/extendscript/ae-index.ts` — and the forks are deleted. It is a *second* entry rather than `index.ts` because AE constructs no IR, and importing the pipeline measured 118 KB against the helper bundle's 13.5 KB. What has not shipped: AE still generates CSS directly and still runs no transform, so §2.1's assignment is still violated and `runtimeChecked` is still `false`. Closing that is the temporal-scene work, not another build slot.

### 12.9 The product boundary is the embed, not the artboard

**The scope question is settled: After Effects is in.** The product is defined by the user's job — *a graphics desk person made a thing and needs to embed it in a web page* — not by whether the output happens to be a positioned-text fragment. Motion work sits inside that boundary, and other motion tools should be able to join later.

The mistake worth recording: an earlier draft of this section inferred product scope from code sharing, and concluded that because the AE exporter shares nothing with the core it might be a different product. That is backwards. Code sharing is an implementation fact. It describes how well the contract currently generalizes, not where the product ends.

**What this changes.** The current IR conflates *the document model* with *the static-graphic document model*. `Document` is metadata + settings + fonts + customBlocks + assets + `artboards[]`, where an artboard's visibility is a function of viewport width. AE has every one of those concepts except the last, and reimplements several because there is no seam letting it take only the parts it needs.

> **STATUS: DEFERRED.** The split below was costed after it was proposed and does not currently clear the bar — 46 `.artboards` call sites in `src/`, 52 in `test/`, and 72 JSON fixtures, to introduce a union with **one member implemented**. The `external` kind was dropped outright (no entry point; we would own third-party failures we cannot see). The claim in §12.8 that After Effects joining the core costs "one build-script slot" was wrong: that exporter contains zero occurrences of `irVersion` or `artboards` and never constructs IR at all, so putting it on the core means inventing the entire temporal scene — the largest item in the plan, priced as free.
>
> **What ships instead:** export the shared google-fonts and escape helpers through `src/extendscript/index.ts` and give AE the bundle slot (~90% of the dedupe benefit, zero contract churn). `Document` stays as-is. (`Artboard.relationship` was added here as "one field" and then removed again under D27: it had zero consumers, and a field nothing reads is the pattern this work exists to remove. It returns with `groupArtboards`, which is where it has to act and which is blocked on ES3 safety — D19.) If a second scene kind actually ships, add `scene` as an optional discriminated field then.
>
> **The envelope contents below are also wrong and must be revised before this is ever picked up.** `Settings` is predominantly static-renderer policy (`imageFormat`, `responsiveness`, `renderRotatedSkewedTextAs`, `includeResizerCss`), and assets are structurally artboard-bound — `Asset.artboardId` is required (`schema.ts#artboardId`) and cross-validated against the artboard graph by the document `superRefine`. Putting settings and assets in a "universal" envelope would move static coupling rather than remove it, then freeze it into the contract.
>
> **Correct decomposition when revisited:** only `irVersion`, `source`, and `metadata` are universal. Scene-specific configuration *and resources* live beside the scene. A unified resource catalog, if ever wanted, needs generic ownership — `{ owner: { kind, id } }` — not a mandatory `artboardId`.
>
> See `internal-docs/product-decisions.md` D9/D13/D13b.

**Target — split the envelope from the scene.**

```
Document = Envelope + Scene

Envelope  (shared by every surface, no exceptions)
  irVersion, source, metadata, settings, fonts, customBlocks, assets

Scene     (tagged union, per-kind transforms and emitters)
  { kind: "static",   artboards: Artboard[] }      // visibility = f(viewport width)
  { kind: "temporal", composition: Composition }   // visibility = f(time)
  { kind: "external", runtime: RuntimeHandoff }    // all2html renders nothing; it wraps
```

The third kind was discovered by the pressure test in §12.10 and is not speculative — it is what a Datawrapper embed, a Rive state machine, a D3 script, and a Three.js scene all reduce to.

Envelope transforms — settings resolution, font mapping and Google Fonts, asset management, custom blocks, warnings, output bundle and manifest — run for **every** document regardless of kind. That alone retires the AE exporter's forked google-fonts and escaping helpers and gets it the output-bundle contract it currently ignores.

Scene transforms — `computeBreakpoints`, `computeStyles`, `deduplicateStyles`, `computePositions` — are static-specific and should be typed as such rather than presented as "the pipeline."

Emitters declare which scene kinds they accept. This needs no new mechanism: it is the same capability declaration as §12.5, which generalizes here for free. The HTML/Svelte/React emitters declare `static`; the AE player declares `temporal`; a future emitter may accept both.

**Consequence for §12.1.** This is now *upstream* of the phase-type work, not a side question. Cleaning up the phase types while assuming every document has `artboards[]` bakes static-ness into the types and guarantees a second pass. Decide the envelope/scene split first, then design the phase types over it.

**Candidate future surfaces** (all fit the temporal or envelope-only shape, none require a new product):
- **Lottie / Bodymovin** — the same After Effects comps, exported as vector JSON instead of rendered video. Scalable, far smaller, and text can stay live rather than baked into pixels. The most valuable near-term addition precisely because it is not a new tool for the user to learn.
- **Rive** — state-machine animations with a small web runtime; strong fit for interactive explainers.
- **Cavalry** — scriptable motion design, comparable extraction story to AE.
- **Blender** — 3D explainers via its Python API; envelope-only, output is a rendered sequence.
- **Spline** — web-native 3D.

The test of the split: adding one of these should touch a scene kind and an emitter, and nothing in the envelope.

### 12.10 Pressure test: what candidate tools break

The envelope/scene split above was tested against tools all2html does not support, to find where the contract fails before committing to it. Six corrections came out of it. A candidate that fits cleanly is as informative as one that breaks — Photoshop (single canvas, text layers over raster) needs nothing new, which is evidence the static scene is correctly shaped for its class.

**1. Scene kind belongs to the export, not the surface.** After Effects can produce a rendered video *or* Lottie/Bodymovin vector JSON from the same composition — `temporal-raster` and `temporal-vector`, same tool, same document. An earlier draft had surfaces declaring scene kinds; they cannot. The declaration lives on the export, and one surface may offer several.

**2. Three scene kinds, not an open-ended set.** The first instinct was to generalize to "progression axes" — width, time, scroll offset, pan/zoom, interaction state. That over-generalizes. Rive state machines are graphs, not axes; a Datawrapper embed has no axis all2html controls. All of them — Rive, Datawrapper, Flourish, Observable, D3, Three.js, Spline — reduce to the same thing: **all2html does not render the scene, it wraps a runtime.** One `external` kind absorbs the whole category, and the axis abstraction is not needed.

**3. The envelope is separable and is the larger product idea.** A third-party chart embed contributes *zero* scene, yet still wants everything else all2html does: credit line, alt text, headline/leadin, responsive wrapper, font handling, asset manifest, CMS-ready bundle. That case proves the envelope stands alone. "The newsroom embed envelope" is a broader and more defensible product than "the artboard renderer," and the split makes it reachable rather than hypothetical.

**4. The coordinate contract is static-scoped, not a global IR rule.** `CLAUDE.md` currently states "all positions in IR are absolute pixels, top-left origin, per-artboard coordinate space" as though it governs the IR. Maps (QGIS, Mapbox) have a geographic coordinate space with viewport-relative labels; temporal scenes key overlays to time. The rule is correct *for the static scene* and must be scoped there.

**5. `artboards[]` conflates two different relationships — and this is the one finding that ships now.** It is a single field on `Artboard`, independent of the deferred split. Multiple artboards currently mean "responsive alternates — pick one by width." But an InDesign document's pages, or a set of artboards a designer intends as separate deliverables, are a *sequence*: all of them, in order, not one chosen by viewport. The `multiple-files` setting is the model trying to express this and failing — which is why it is easier to leave unwired than to implement. The relationship must be explicit in the scene (`alternates` vs `sequence`) rather than inferred from a setting at emit time. **This reclassifies a "missing wiring" bug as a modelling gap** and should be fixed in the contract phase, not the cleanup phase. **Status: not in the IR.** The field was declared and validated ahead of its consumer and removed under D27; it lands together with the `groupArtboards` rewiring that consumes it, not before.

**6. Capability declarations must be bidirectional.** §12.5 declares what a surface *honors*. Scrollytelling exposes the other direction: a scene driven by the host page's scroll position cannot be a self-contained embed, so the output must declare what it *requires of its host* — self-contained, requires a runtime script, requires scroll integration, requires host-page CSS. The output-bundle contract currently assumes self-containment universally. Without the reverse declaration, the failure mode is an embed that looks fine in preview and does nothing on the page.

---

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
