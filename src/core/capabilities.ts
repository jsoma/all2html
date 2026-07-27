/**
 * Surface capability declarations.
 *
 * Each surface declares, as **data**, which settings and features it actually
 * honors, and — via `divergesAtDefault` — what it does instead. The core
 * validates resolved settings against the active surface's declaration and
 * warns whenever the requested value is not what the surface will produce,
 * naming the setting, the surface, and what happens instead (SPEC §12.5).
 *
 * The comparison is request-vs-reality, not request-vs-default. See
 * `checkSurfaceCapabilities`.
 *
 * The declarations are keyed by `SETTING_DEFINITIONS` in
 * `../ir/settings-definitions.js` — that table stays the single source for the
 * setting list and its defaults, and this table says what each surface does
 * with each entry. A setting with no entry falls back to the surface's
 * `defaultStatus`.
 *
 * Seeded from `internal-docs/capability-matrix.md`; every `DEAD` cell in that
 * document appears below as `unsupported` (or `partial` where the surface
 * honors a real subset), with the matrix's evidence id in the note's comment.
 *
 * ES3-safe: plain object literals, index loops, no `Map`/`Set`. The Illustrator
 * declaration and the checker ship inside the ExtendScript bundle; the other
 * declarations are tree-shaken out of it because nothing in
 * `src/extendscript/` references them.
 */

import { SETTING_DEFINITIONS } from "../ir/settings-definitions.js";
import type { Settings } from "../ir/types.js";
import {
  createWarning,
  type StructuredWarning,
  type SurfaceId,
  type SurfacePath,
} from "./warnings.js";

export type SettingSupportStatus =
  /** Read and acted on. */
  | "honored"
  /** Acted on for some values, paths, or output formats only. See the qualifiers. */
  | "partial"
  /** The surface exposes or accepts it and does nothing with it. */
  | "unsupported"
  /** Meaningless here — the surface never reaches the code the setting drives. */
  | "na";

export interface SettingSupport {
  status: SettingSupportStatus;
  /** Enum / enum-array settings: the subset of values actually honored. */
  values?: readonly string[];
  /** Honored only when running these entry paths. */
  paths?: readonly SurfacePath[];
  /** Not honored when emitting these formats. */
  unsupportedFormats?: readonly string[];
  /**
   * The setting is honored for some document content and not for other content,
   * so a settings-only check cannot decide it. The emitter that produces the
   * unhonored case warns at its own call site with this code; the checker stays
   * silent so ordinary exports are not told about a problem their document does
   * not have. The entry still exists so the capability tables and the generated
   * support matrix record the gap.
   */
  warnedByEmitter?: string;
  /**
   * The value this surface **actually behaves as**, declared only when that
   * differs from the global default in `SETTING_DEFINITIONS`.
   *
   * This is the whole point of the checker: a request is honest or broken
   * relative to what the surface really does, never relative to a default the
   * surface may not implement. Figma exports at `scale: 1`
   * (`FIGMA_EXPORT_PARAMS` in `plugins/figma/src/runtime-extract.ts`, pinned
   * against this declaration by `test/unit/figma-runtime.test.ts`) while
   * `use2xImages` defaults to `true`, so
   * Figma declares `divergesAtDefault: false` — and then warns for `true` and
   * for the omitted case (which resolves to `true`), and stays silent for
   * `false`, which is what it does.
   *
   * `null` means "no equivalent behavior here at all" — nothing the user can
   * set is honored, so every value warns. Use it only when the surface reaches
   * the code the setting drives and does something else entirely; when the
   * surface never reaches that code the setting is unobservable, and omitting
   * this field keeps the default quiet.
   *
   * Omitting it asserts the surface behaves as the documented default.
   */
  divergesAtDefault?: unknown;
  /** What happens instead. This is the payload of the warning the user sees. */
  note: string;
}

export type FeatureSupportStatus = "honored" | "unsupported" | "na";

export interface FeatureSupport {
  status: FeatureSupportStatus;
  note: string;
}

export interface SurfaceCapabilities {
  surface: SurfaceId;
  /** Human name used in warning text. */
  label: string;
  /**
   * Whether this declaration is actually enforced at export time — i.e. some
   * entry point runs the checker for this surface and shows the warnings.
   *
   * `false` means the table below is documentation only. After Effects is the
   * one such surface: its exporter never loads the core bundle
   * (`grep -c All2Html plugins/after-effects/exporter.jsx` → 0), so nothing
   * there can call the checker. `test/unit/capabilities.test.ts` pins both the
   * flag and the presence/absence of a real call site, so the claim cannot
   * quietly become untrue in either direction.
   */
  runtimeChecked: boolean;
  /** Applied to any setting with no explicit entry below. */
  defaultStatus: SettingSupportStatus;
  defaultNote: string;
  settings: { [key: string]: SettingSupport };
}

/**
 * Feature (as opposed to setting) support, keyed by surface.
 *
 * Kept in a separate table from `SurfaceCapabilities` on purpose: the checker
 * never reads it, so keeping it out of the declaration keeps ~1.6 KB of prose
 * out of the ExtendScript bundle, which ships the Illustrator declaration.
 */
export type SurfaceFeatures = { [key: string]: FeatureSupport };

/** Which surface, and which of its entry points, is running. */
export interface SurfaceContext {
  surface: SurfaceId;
  path?: SurfacePath;
  /** Emitter format the run is targeting, when known. */
  format?: string;
}

/* ------------------------------------------------------------------ */
/* Shared entries                                                      */
/* ------------------------------------------------------------------ */

/*
 * D31 is retired: `useLazyLoader` used to be honored for images and dead for
 * video — the markup carried `data-src` and no `src`, and no surface emitted a
 * loader — so it was declared `partial` here with
 * `warnedByEmitter: "video:lazy-src-no-loader"`. `src/emitters/shared/lazy-video.ts`
 * now ships the loader on every format (a `<script>` for html/standalone, a
 * lifecycle effect for svelte/react), so there is no divergence left to declare
 * and the setting falls through to each surface's `defaultStatus` of "honored".
 */

/**
 * Matrix footnote 5 — the extension is an `html` emitter concept only.
 *
 * `registry-shared.ts:52` is the single reader; `:66` forces `.svelte`, `:79`
 * forces `.jsx`/`.tsx`, and `:93` hardcodes `.html` for standalone. Declared
 * `partial` with the three formats that ignore it, so a non-default extension
 * warns exactly when the run is targeting one of them — and an untouched
 * `.html` stays silent on every format, because that is what those formats
 * would have produced anyway.
 *
 * Illustrator carries no entry: it emits `html` only and writes the extension
 * verbatim (`exporter.jsx:1815`), so it honors the setting outright.
 *
 * Shared, and declared here rather than beside the other shared entries,
 * because the Figma table below references it and a `const` is in its temporal
 * dead zone until this line runs.
 */
const HTML_ONLY_OUTPUT_EXTENSION: SettingSupport = {
  status: "partial",
  unsupportedFormats: ["standalone", "svelte", "react"],
  note: "Only the html emitter uses this extension. The svelte and react emitters force .svelte and .jsx/.tsx, and the standalone emitter always writes .html.",
};

/* ------------------------------------------------------------------ */
/* Illustrator                                                         */
/* ------------------------------------------------------------------ */

export const illustratorCapabilities: SurfaceCapabilities = {
  surface: "illustrator",
  label: "Illustrator",
  runtimeChecked: true,
  defaultStatus: "honored",
  defaultNote: "",
  settings: {
    // D1 — exporter.jsx:1177-1194 branches on "jpg" and rasterizes PNG8 otherwise.
    imageFormat: {
      status: "partial",
      values: ["auto", "png", "jpg"],
      note: "Illustrator rasterizes 8-bit PNG for every value except jpg, so png24 and svg both produce an 8-bit PNG.",
    },
    // D3 — zero readers; exporter.jsx:1767 calls exportImages unconditionally.
    writeImageFiles: {
      status: "unsupported",
      note: "Illustrator always writes image files.",
    },
    // D10 — groupArtboards is never imported by src/extendscript/index.ts.
    output: {
      status: "unsupported",
      note: "Illustrator always emits a single HTML file. Artboard grouping is deliberately not wired into the ExtendScript bundle yet.",
    },
    // N1 — absent from buildCanonicalIrSettings and from the panel key map.
    responsiveImageMode: {
      status: "unsupported",
      note: "Illustrator always emits img-src images.",
    },
    // D16 — no reader of settings.inlineSvg anywhere; only the per-layer flag is read.
    inlineSvg: {
      status: "unsupported",
      note: "Tag individual layers with :svg,inline instead. The document-level setting is not read.",
    },
    // D19 — the only implementation was src/core/svg-postprocess.ts, which had no
    // importers on any surface and has been deleted (D16). Nothing replaces it: this
    // declaration is now the whole story, and the checker below is what stops the
    // setting from silently no-opping. Reinstating id prefixing means writing it into
    // the emitter that produces the ids and flipping these four declarations together.
    svgIdPrefix: {
      status: "unsupported",
      note: "SVG id prefixing is not implemented on any surface; ids are emitted unprefixed.",
    },
    // D28 — the standalone emitter is unreachable from src/extendscript/index.ts.
    localPreviewTemplate: {
      status: "unsupported",
      note: "Illustrator emits an HTML fragment only, so the standalone preview template is never applied.",
    },
  },
};

export const illustratorFeatures: SurfaceFeatures = {
  "format:html": { status: "honored", note: "" },
  "format:standalone": {
    status: "unsupported",
    note: "The standalone emitter is not reachable from the ExtendScript bundle.",
  },
  "format:svelte": { status: "unsupported", note: "Illustrator emits HTML only." },
  "format:react": { status: "unsupported", note: "Illustrator emits HTML only." },
  "tag:svg": { status: "honored", note: "" },
  "tag:svg-inline": { status: "honored", note: "Accepts :svg,inline and :inline." },
  "tag:png": { status: "honored", note: "" },
  "tag:symbol": { status: "honored", note: "" },
  "tag:div": { status: "honored", note: "" },
  "tag:video": { status: "honored", note: "" },
  "tag:html-hooks": { status: "honored", note: "" },
  "responsive-grouping": { status: "honored", note: "" },
  "retina-raster": { status: "honored", note: "" },
  "text-hyperlinks": { status: "honored", note: "" },
  "custom-blocks": {
    status: "honored",
    note: "Matches all2html- and ai2html- prefixed block names; all2html- wins key-by-key when a document carries both settings blocks.",
  },
  "promo-image": { status: "honored", note: "" },
  "text-effects": {
    status: "unsupported",
    note: "No exporter populates TextElement.effects.",
  },
};

/* ------------------------------------------------------------------ */
/* After Effects                                                       */
/* ------------------------------------------------------------------ */

export const afterEffectsCapabilities: SurfaceCapabilities = {
  surface: "after-effects",
  label: "After Effects",
  // Documentation only. The AE exporter never loads the core bundle, so nothing
  // there can run the checker: an AE config carrying `{"settings":{"imageFormat":
  // ["svg"]}}` is ignored with no warning today, and this table does not change
  // that. Enforcing it means putting AE on the core bundle (SPEC 12.8), which is
  // the temporal-scene work, not a capability-table change.
  runtimeChecked: false,
  // The AE exporter never constructs IR, so every core setting is meaningless
  // there rather than merely ignored.
  defaultStatus: "na",
  defaultNote:
    "The After Effects exporter does not run the shared pipeline; it splices its own player template.",
  settings: {
    googleFonts: {
      status: "honored",
      note: "Handled by the exporter's own copy of the Google Fonts helper (exporter.jsx:369).",
    },
  },
};

export const afterEffectsFeatures: SurfaceFeatures = {
  "format:html": {
    status: "unsupported",
    note: "After Effects writes HTML through its own player template, not a core emitter.",
  },
  "format:standalone": { status: "na", note: "" },
  "format:svelte": { status: "na", note: "" },
  "format:react": { status: "na", note: "" },
  "responsive-grouping": { status: "na", note: "" },
};

/* ------------------------------------------------------------------ */
/* Figma                                                               */
/* ------------------------------------------------------------------ */

const FIGMA_RASTER_NOTE =
  "The Figma runtime exports transparent PNG at 1x with no format, quantizer, or quality controls.";

export const figmaCapabilities: SurfaceCapabilities = {
  surface: "figma",
  label: "the Figma plugin",
  runtimeChecked: true,
  defaultStatus: "honored",
  defaultNote: "",
  settings: {
    // D2 — runtime-extract.ts hardcodes exportAsync({format:"PNG"}), which is
    // full-color PNG with an alpha channel: Figma's ExportSettingsImage carries
    // no bit-depth, palette, or matte option. A request for `auto` or `png24`
    // therefore lands where the user asked; `png` (8-bit), `jpg` and `svg` do
    // not. The extracted assets record exactly these three facts in
    // `exportParams`, and the agreement is asserted in figma-runtime.test.ts.
    imageFormat: {
      status: "partial",
      values: ["auto", "png24"],
      note: "The Figma runtime always exports full-color PNG with alpha, equivalent to png24.",
    },
    // D6-D9. The three PNG knobs are live-but-ignored: Figma does emit PNG, so
    // its behavior is observable and diverges from the default, which is why
    // they carry `divergesAtDefault` and warn even when untouched. jpgQuality
    // does not: Figma never emits JPEG, so the value is unobservable rather
    // than wrong, and warning about it on every export would be noise.
    pngTransparent: { status: "unsupported", divergesAtDefault: true, note: FIGMA_RASTER_NOTE },
    pngNumberOfColors: {
      status: "unsupported",
      divergesAtDefault: null,
      note: "The Figma runtime exports full-color PNG with no quantizer, so no color count is honored.",
    },
    jpgQuality: { status: "unsupported", note: FIGMA_RASTER_NOTE },
    use2xImages: { status: "unsupported", divergesAtDefault: false, note: FIGMA_RASTER_NOTE },
    // D4 — assets are always written into the ZIP.
    writeImageFiles: {
      status: "unsupported",
      note: "Figma always writes extracted assets into the export ZIP.",
    },
    // Footnote 5 — Figma emits html and standalone; standalone ignores this.
    htmlOutputExtension: HTML_ONLY_OUTPUT_EXTENSION,
    // D11 — delivery is a ZIP; paths come from the bundle manifest.
    htmlOutputPath: {
      status: "unsupported",
      note: "Figma delivers a ZIP whose layout is fixed by the bundle manifest.",
    },
    // Footnote 7 — the value moves the <img src> prefix but not the ZIP layout.
    imageOutputPath: {
      status: "partial",
      note: "Changing this moves the <img src> prefix but not the asset paths inside the ZIP, so the HTML stops resolving against the bundle.",
    },
    // D13 — runtime-extract.ts:191 hardcodes renderAs:"html".
    renderTextAs: {
      status: "unsupported",
      note: "Figma always emits live HTML text and always hides text before the background raster.",
    },
    // D14
    renderRotatedSkewedTextAs: {
      status: "unsupported",
      note: "Figma always emits rotated and skewed text as live HTML.",
    },
    // D17
    inlineSvg: {
      status: "unsupported",
      note: "Tag individual layers with :svg:inline instead. The document-level setting is not read.",
    },
    // D20
    svgIdPrefix: {
      status: "unsupported",
      note: "SVG id prefixing is not implemented on any surface; ids are emitted unprefixed.",
    },
    // D22
    svgEmbedImages: {
      status: "unsupported",
      note: "Figma's SVG export takes no embed option, so linked images stay referenced.",
    },
    // D24 / D26
    createPromoImage: {
      status: "unsupported",
      note: "Promo image generation is implemented in the Illustrator exporter only.",
    },
    promoImageWidth: {
      status: "unsupported",
      note: "Promo image generation is implemented in the Illustrator exporter only.",
    },
    // D29
    localPreviewTemplate: {
      status: "unsupported",
      note: "The browser standalone emitter reads the template only to discard it.",
    },
  },
};

export const figmaFeatures: SurfaceFeatures = {
  "format:html": { status: "honored", note: "" },
  "format:standalone": { status: "honored", note: "" },
  "format:svelte": { status: "unsupported", note: "Gated off in the plugin UI." },
  "format:react": { status: "unsupported", note: "Gated off in the plugin UI." },
  "tag:svg": { status: "honored", note: "" },
  "tag:svg-inline": { status: "honored", note: "Accepts :svg:inline only." },
  "tag:png": { status: "honored", note: "" },
  "tag:symbol": {
    status: "unsupported",
    note: "Parsed then rejected by the Figma extractor.",
  },
  "tag:div": {
    status: "unsupported",
    note: "Parsed then rejected by the Figma extractor.",
  },
  "tag:video": { status: "honored", note: "" },
  "tag:html-hooks": { status: "honored", note: "" },
  "responsive-grouping": { status: "honored", note: "" },
  "retina-raster": { status: "unsupported", note: FIGMA_RASTER_NOTE },
  "text-hyperlinks": {
    status: "honored",
    note: "URL hyperlinks only; node-level links are dropped with a warning.",
  },
  "custom-blocks": {
    status: "honored",
    note: "Advanced JSONC only; there is no direct UI control.",
  },
  "promo-image": {
    status: "unsupported",
    note: "Promo image generation is implemented in the Illustrator exporter only.",
  },
  "text-effects": { status: "unsupported", note: "No extractor populates TextElement.effects." },
};

/* ------------------------------------------------------------------ */
/* Node CLI                                                            */
/* ------------------------------------------------------------------ */

const RASTER_IMPORT_ONLY =
  "Rasterization settings are honored by `import svg`. The `render` command never rasterizes, so this value is inert.";

// Shared support entries, named so the CLI and browser tables can both point at
// them without either table being built by a function call — rollup drops an
// unreferenced object literal, but never an IIFE, and the ExtendScript bundle
// must not carry the non-Illustrator declarations.
const IMPORT_ONLY_RASTER: SettingSupport = {
  status: "partial",
  paths: ["import"],
  note: RASTER_IMPORT_ONLY,
};
const IMPORT_ONLY_TEXT_RENDER: SettingSupport = {
  status: "partial",
  paths: ["import"],
  note: "Text rendering mode is decided by the exporter that produced the IR. On `render` the value is inert.",
};
// D5
const NODE_WRITE_IMAGE_FILES: SettingSupport = {
  status: "unsupported",
  note: "Extracted assets are always written next to the emitted files.",
};
// D12
const NODE_HTML_OUTPUT_PATH: SettingSupport = {
  status: "unsupported",
  note: "Output location comes from the -o flag.",
};
// D15
const NODE_ROTATED_TEXT: SettingSupport = {
  status: "unsupported",
  note: "Only the Illustrator exporter acts on this; the core always emits rotated and skewed text as live HTML.",
};
// D18
const NODE_INLINE_SVG: SettingSupport = {
  status: "unsupported",
  note: "Only the per-layer inline flag in the IR is read.",
};
// D21
const NODE_SVG_ID_PREFIX: SettingSupport = {
  status: "unsupported",
  note: "SVG id prefixing is not implemented on any surface; ids are emitted unprefixed.",
};
// D23
const NODE_SVG_EMBED_IMAGES: SettingSupport = {
  status: "unsupported",
  note: "Inline SVG keeps linked images referenced.",
};
// D25 / D27
const NODE_PROMO_IMAGE: SettingSupport = {
  status: "unsupported",
  note: "Promo image generation is implemented in the Illustrator exporter only.",
};
// D30 — the one place the browser dropzone diverges from the Node CLI.
const BROWSER_PREVIEW_TEMPLATE: SettingSupport = {
  status: "unsupported",
  note: "The browser standalone emitter reads the template only to discard it.",
};

const CLI_SETTINGS: { [key: string]: SettingSupport } = {
  // Footnotes 1-2 — honored on the SVG import path only.
  imageFormat: IMPORT_ONLY_RASTER,
  pngTransparent: IMPORT_ONLY_RASTER,
  pngNumberOfColors: IMPORT_ONLY_RASTER,
  jpgQuality: IMPORT_ONLY_RASTER,
  use2xImages: IMPORT_ONLY_RASTER,
  renderTextAs: IMPORT_ONLY_TEXT_RENDER,
  writeImageFiles: NODE_WRITE_IMAGE_FILES,
  htmlOutputPath: NODE_HTML_OUTPUT_PATH,
  htmlOutputExtension: HTML_ONLY_OUTPUT_EXTENSION,
  renderRotatedSkewedTextAs: NODE_ROTATED_TEXT,
  inlineSvg: NODE_INLINE_SVG,
  svgIdPrefix: NODE_SVG_ID_PREFIX,
  svgEmbedImages: NODE_SVG_EMBED_IMAGES,
  createPromoImage: NODE_PROMO_IMAGE,
  promoImageWidth: NODE_PROMO_IMAGE,
};

/** Same table as the CLI, plus the one divergence recorded in D30. */
const BROWSER_SETTINGS: { [key: string]: SettingSupport } = {
  imageFormat: IMPORT_ONLY_RASTER,
  pngTransparent: IMPORT_ONLY_RASTER,
  pngNumberOfColors: IMPORT_ONLY_RASTER,
  jpgQuality: IMPORT_ONLY_RASTER,
  use2xImages: IMPORT_ONLY_RASTER,
  renderTextAs: IMPORT_ONLY_TEXT_RENDER,
  writeImageFiles: NODE_WRITE_IMAGE_FILES,
  htmlOutputPath: NODE_HTML_OUTPUT_PATH,
  htmlOutputExtension: HTML_ONLY_OUTPUT_EXTENSION,
  renderRotatedSkewedTextAs: NODE_ROTATED_TEXT,
  inlineSvg: NODE_INLINE_SVG,
  svgIdPrefix: NODE_SVG_ID_PREFIX,
  svgEmbedImages: NODE_SVG_EMBED_IMAGES,
  createPromoImage: NODE_PROMO_IMAGE,
  promoImageWidth: NODE_PROMO_IMAGE,
  localPreviewTemplate: BROWSER_PREVIEW_TEMPLATE,
};

export const sharedNodeFeatures: SurfaceFeatures = {
  "format:html": { status: "honored", note: "" },
  "format:standalone": { status: "honored", note: "" },
  "format:svelte": { status: "honored", note: "" },
  "format:react": { status: "honored", note: "" },
  "tag:svg": { status: "honored", note: "Read from the IR; the SVG importer never produces one." },
  "tag:svg-inline": {
    status: "honored",
    note: "Read from the IR; the SVG importer never produces one.",
  },
  "tag:png": { status: "honored", note: "Read from the IR; the SVG importer never produces one." },
  "tag:symbol": {
    status: "honored",
    note: "Read from the IR; the SVG importer never produces one.",
  },
  "tag:div": { status: "honored", note: "Read from the IR; the SVG importer never produces one." },
  "tag:video": {
    status: "honored",
    note: "Read from the IR; the SVG importer never produces one.",
  },
  "tag:html-hooks": {
    status: "honored",
    note: "Read from the IR; the SVG importer never produces one.",
  },
  "responsive-grouping": { status: "honored", note: "" },
  "retina-raster": { status: "honored", note: "Import path only." },
  "text-hyperlinks": { status: "honored", note: "" },
  "custom-blocks": { status: "honored", note: "Read from the IR; SVG import produces none." },
  "promo-image": {
    status: "unsupported",
    note: "Promo image generation is implemented in the Illustrator exporter only.",
  },
  "text-effects": {
    status: "honored",
    note: "Rendered when present in the IR, but no importer or exporter produces one.",
  },
};

export const cliCapabilities: SurfaceCapabilities = {
  surface: "cli",
  label: "the all2html CLI",
  runtimeChecked: true,
  defaultStatus: "honored",
  defaultNote: "",
  settings: CLI_SETTINGS,
};

/**
 * The browser dropzone. Identical to the CLI apart from one real divergence:
 * `standalone-browser.ts` reads `localPreviewTemplate` only to discard it
 * (matrix D30), whereas the Node standalone emitter applies it.
 */
export const browserCapabilities: SurfaceCapabilities = {
  surface: "browser",
  label: "the browser converter",
  runtimeChecked: true,
  defaultStatus: "honored",
  defaultNote: "",
  settings: BROWSER_SETTINGS,
};

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const SURFACE_CAPABILITIES: readonly SurfaceCapabilities[] = [
  illustratorCapabilities,
  afterEffectsCapabilities,
  figmaCapabilities,
  cliCapabilities,
  browserCapabilities,
];

export function getSurfaceCapabilities(surface: SurfaceId): SurfaceCapabilities {
  for (let i = 0; i < SURFACE_CAPABILITIES.length; i++) {
    if (SURFACE_CAPABILITIES[i].surface === surface) return SURFACE_CAPABILITIES[i];
  }
  throw new Error("Unknown surface: " + String(surface));
}

export const SURFACE_FEATURES: { [key: string]: SurfaceFeatures } = {
  illustrator: illustratorFeatures,
  "after-effects": afterEffectsFeatures,
  figma: figmaFeatures,
  cli: sharedNodeFeatures,
  browser: sharedNodeFeatures,
};

export function getSurfaceFeatures(surface: SurfaceId): SurfaceFeatures {
  const features = SURFACE_FEATURES[surface];
  if (!features) throw new Error("Unknown surface: " + String(surface));
  return features;
}

/* ------------------------------------------------------------------ */
/* Checker                                                             */
/* ------------------------------------------------------------------ */

/** Stable code for "you set this and the surface will not act on it". */
export const SETTING_UNSUPPORTED_CODE = "setting:unsupported";

function isArrayValue(value: unknown): value is unknown[] {
  return Object.prototype.toString.call(value) === "[object Array]";
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isArrayValue(a) && isArrayValue(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return a === b;
}

function contains(list: readonly string[] | undefined, value: string | undefined): boolean {
  if (!list || value === undefined) return false;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

/** True when every value of the setting is inside the honored subset. */
function valuesAreHonored(value: unknown, honored: readonly string[]): boolean {
  const list = isArrayValue(value) ? value : [value];
  for (let i = 0; i < list.length; i++) {
    if (!contains(honored, String(list[i]))) return false;
  }
  return true;
}

function formatValue(value: unknown): string {
  if (isArrayValue(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(String(value[i]));
    return parts.join(", ");
  }
  if (value === null) return "null";
  return String(value);
}

/**
 * Returns the reason `support` will not honor `value` in `context`, or `null`
 * when it will. Purely a lookup over the declaration — no per-setting branches.
 */
function unhonoredReason(
  support: SettingSupport,
  value: unknown,
  context: SurfaceContext,
): string | null {
  if (support.status === "unsupported" || support.status === "na") return support.note;

  let qualified = false;
  if (support.paths) {
    qualified = true;
    if (!contains(support.paths, context.path)) return support.note;
  }
  if (support.unsupportedFormats) {
    qualified = true;
    if (contains(support.unsupportedFormats, context.format)) return support.note;
  }
  if (support.values) {
    qualified = true;
    if (!valuesAreHonored(value, support.values)) return support.note;
  }
  // `partial` with no qualifier means "honored only at the value the surface
  // actually produces"; the caller compares against that value.
  if (support.status === "partial" && !qualified) return support.note;
  return null;
}

/**
 * Warn for every resolved setting whose value the active surface will not
 * produce.
 *
 * The comparison is against **what the surface actually does**, never against
 * the global default. Comparing against the default gets the answer wrong in
 * both directions on any surface that does not implement the default: Figma
 * exports at 1x, so `use2xImages` left at its default `true` was silently
 * honored-looking while the output was 1x, and an explicit `false` — the one
 * value Figma does produce — warned. A surface states its real behavior with
 * `divergesAtDefault`; omitting it asserts the default is what happens.
 *
 * A request that matches the surface's real behavior is never a warning, which
 * is what keeps ordinary exports quiet: a surface that ignores a setting but
 * lands on the documented default anyway (Illustrator always writes image
 * files, and `writeImageFiles` defaults to `true`) says nothing until the user
 * asks for something else.
 */
export function checkSurfaceCapabilities(
  declaration: SurfaceCapabilities,
  settings: Settings,
  context: SurfaceContext,
): StructuredWarning[] {
  const warnings: StructuredWarning[] = [];

  for (let i = 0; i < SETTING_DEFINITIONS.length; i++) {
    const definition = SETTING_DEFINITIONS[i];
    const key = definition.key as string;
    const declared = declaration.settings[key];
    const support: SettingSupport = declared || {
      status: declaration.defaultStatus,
      note: declaration.defaultNote,
    };
    if (support.status === "honored" && !support.paths && !support.unsupportedFormats) continue;
    // Content-dependent: the emitter warns where the harm actually happens.
    if (support.warnedByEmitter) continue;

    const value = (settings as unknown as { [key: string]: unknown })[key];
    const reason = unhonoredReason(support, value, context);
    if (reason === null) continue;

    // What the surface really produces. `divergesAtDefault: null` means it
    // produces nothing comparable, so every request is a divergence.
    const diverges = "divergesAtDefault" in support;
    const actual = diverges ? support.divergesAtDefault : definition.defaultValue;
    if (sameValue(value, actual)) continue;

    const behavior = diverges && actual !== null ? "; it behaves as " + formatValue(actual) : "";
    const message =
      'Setting "' +
      key +
      '" is set to ' +
      formatValue(value) +
      " but " +
      declaration.label +
      " does not honor it" +
      behavior +
      "." +
      (reason ? " " + reason : "");

    warnings.push(
      createWarning(SETTING_UNSUPPORTED_CODE, "setting", message, {
        setting: key,
        surface: declaration.surface,
      }),
    );
  }

  return warnings;
}

/**
 * Registry-resolving convenience wrapper. Kept separate from
 * `checkSurfaceCapabilities` so a surface that only needs its own declaration —
 * Illustrator, inside the ExtendScript bundle — never pulls the other surfaces'
 * declarations into its build.
 */
export function checkCapabilitiesForSurface(
  settings: Settings,
  context: SurfaceContext,
): StructuredWarning[] {
  return checkSurfaceCapabilities(getSurfaceCapabilities(context.surface), settings, context);
}
