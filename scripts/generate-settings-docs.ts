/**
 * Generates the public settings reference and the public support matrix from
 * the declarations that the product actually runs on:
 *
 * - `src/ir/settings-definitions.ts` — the setting list, kinds, ranges, defaults
 *   and the panel help copy
 * - `src/core/capabilities.ts` — what each surface does with each setting, and
 *   which features (output formats, special-layer tags) each surface supports
 * - `src/ir/schema.ts` — the metadata field list, so the page can say which
 *   commonly-confused keys are *not* settings
 *
 * The hand-maintained version of `docs/reference/settings.md` drifted badly:
 * it listed `slug` (a metadata field) as an Output setting, omitted 16 of the
 * 33 settings entirely, named 5 more without ever defining them, carried no
 * defaults or types, and said nothing about which surfaces honor what. Every
 * one of those facts already existed as data; only the page was hand-written.
 *
 * Usage:
 *   pnpm docs:generate          # write the files
 *   pnpm check:generated-docs   # fail if the committed files are stale (CI)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getSurfaceFeatures,
  type SettingSupport,
  type SettingSupportStatus,
  SURFACE_CAPABILITIES,
  type SurfaceCapabilities,
} from "../src/core/capabilities.js";
import { MetadataSchema } from "../src/ir/schema.js";
import { getSettingHelpDefinition } from "../src/ir/setting-help.js";
import { SETTING_DEFINITIONS, type SettingDefinition } from "../src/ir/settings-definitions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const SETTINGS_DOC_PATH = resolve(rootDir, "docs/reference/settings.md");
const SUPPORT_MATRIX_DOC_PATH = resolve(rootDir, "docs/reference/support-matrix.md");

/** `SETTING_DEFINITIONS` is a heterogeneous const tuple; widen it once. */
const definitions: readonly SettingDefinition[] = SETTING_DEFINITIONS;

const GENERATED_BANNER = [
  "<!--",
  "  GENERATED FILE — do not edit by hand.",
  "  Source: src/ir/settings-definitions.ts, src/ir/setting-help.ts, src/core/capabilities.ts, src/ir/schema.ts",
  "  Regenerate: pnpm docs:generate",
  "  CI fails when this file is stale: pnpm check:generated-docs",
  "-->",
].join("\n");

/* ------------------------------------------------------------------ */
/* Descriptions for settings with no panel help copy                   */
/* ------------------------------------------------------------------ */

/**
 * `SETTING_HELP` (src/ir/setting-help.ts) covers only the settings the CEP panel
 * surfaces.
 * The rest still need a sentence on the public page, so they live here, keyed
 * by setting. Generation fails if a setting has neither help nor an entry, so a
 * new setting cannot be added without a description.
 *
 * Each line is a statement about what the setting *asks for*. What any given
 * surface actually does with it comes from the capability declarations below —
 * never restate behavior here.
 */
const EXTRA_DESCRIPTIONS: Record<string, string> = {
  writeImageFiles:
    "Asks the exporter to write extracted image assets to disk alongside the emitted output.",
  pngTransparent: "Exports PNG backgrounds with a transparent background instead of a flat matte.",
  pngNumberOfColors:
    "Size of the color palette used when quantizing 8-bit PNG output. Fewer colors means smaller files and more banding.",
  jpgQuality: "JPEG compression quality for rasterized backgrounds, from 0 (worst) to 100 (best).",
  cacheBustToken:
    "Appended to every emitted image URL as `?v=<token>` so a re-export busts CDN and browser caches.",
  namespace:
    "Prefix applied to every generated CSS class and id (`g-artboard`, `g-pstyle0`, and so on). Change it when the host page already uses the default prefix.",
  projectName:
    "Base name used for emitted files, the container id, and the CSS scope. Falls back to `metadata.slug` when empty.",
  htmlOutputExtension:
    "File extension used for emitted HTML files, for CMSes that expect something other than `.html`.",
  imageSourcePath:
    "Prefix prepended to image `src` attributes in the emitted HTML. Use it when images are served from a different URL root than the one they were written to.",
  maxWidth:
    "Caps the width of the generated container in pixels. `null` leaves the graphic uncapped.",
  centerHtmlOutput: "Centers the generated container and its artboards with `margin: 0 auto`.",
  renderRotatedSkewedTextAs:
    "Whether rotated and skewed text is kept as live HTML or baked into the background image. Browsers place transformed text less predictably than upright text.",
  testingMode:
    "Tints live HTML text red so it is obvious which text is real HTML and which is baked into the background image.",
  includeResizerWidths:
    "Adds `data-min-width` / `data-max-width` attributes to each artboard so an external resizer script can pick the right variant.",
  responsiveImageMode:
    "How responsive background images are attached: as `<img src>` elements, or as CSS custom properties so only the visible artboard's image is fetched.",
  useLazyLoader: "Defers loading of background images and video until they are near the viewport.",
  svgIdPrefix:
    "Prefix applied to ids inside inline SVG output, so several inline SVGs on one page cannot collide.",
  clickableLink: "Wraps the whole graphic in a link to this URL.",
  createPromoImage: "Also exports a standalone promo/social image alongside the normal output.",
  promoImageWidth: "Width in pixels of the exported promo image.",
  localPreviewTemplate:
    "Path to a template file that the standalone emitter wraps the output in, instead of its built-in page shell.",
};

/* ------------------------------------------------------------------ */
/* Editorial labels for capability feature keys                        */
/* ------------------------------------------------------------------ */

/**
 * Feature keys are stable identifiers, not prose. Anything not listed here
 * renders as its raw key rather than failing generation, so adding a feature
 * never breaks the docs build — it just looks unpolished until it is named.
 */
const FEATURE_LABELS: Record<string, string> = {
  "format:html": "`html` (fragment)",
  "format:standalone": "`standalone` (full page)",
  "format:svelte": "`svelte` component",
  "format:react": "`react` component",
  "tag:svg": "SVG overlay layer",
  "tag:svg-inline": "Inline SVG layer",
  "tag:png": "PNG overlay layer",
  "tag:symbol": "Symbol layer",
  "tag:div": "Div layer",
  "tag:video": "Video layer",
  "tag:html-hooks": "HTML hook layers",
  "responsive-grouping": "Responsive artboard/frame grouping",
  "retina-raster": "2x (retina) raster export",
  "text-hyperlinks": "Hyperlinks on text runs",
  "custom-blocks": "Custom CSS/JS/HTML blocks",
  "promo-image": "Promo image export",
  "text-effects": "Text effects (drop shadow, blur)",
};

/** Canonical spelling of each tagged-layer feature, per surface family. */
const TAG_SPELLINGS: Record<string, string> = {
  "tag:svg": "`:svg`",
  "tag:svg-inline": "see the syntax notes below",
  "tag:png": "`:png`",
  "tag:symbol": "`:symbol`",
  "tag:div": "`:div`",
  "tag:video": "`:video`",
  "tag:html-hooks": "`:html-before`, `:html-after`",
};

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * `SurfaceCapabilities.label` is written for warning sentences ("the Figma
 * plugin does not honor it"), so it is article-led and cannot be title-cased
 * mechanically ("the all2html CLI" must not become "All2html CLI"). Column
 * headers come from here instead; generation fails for an unnamed surface.
 */
const SURFACE_DISPLAY_NAMES: Record<string, string> = {
  illustrator: "Illustrator",
  "after-effects": "After Effects",
  figma: "Figma plugin",
  cli: "all2html CLI",
  browser: "Browser converter",
};

function surfaceName(surface: SurfaceCapabilities): string {
  const name = SURFACE_DISPLAY_NAMES[surface.surface];
  if (!name) {
    throw new Error(
      `Surface "${surface.surface}" has no display name. ` +
        "Add one to SURFACE_DISPLAY_NAMES in scripts/generate-settings-docs.ts.",
    );
  }
  return name;
}

const surfaces = SURFACE_CAPABILITIES;
const surfaceNames = surfaces.map(surfaceName);

function code(value: string): string {
  return `\`${value}\``;
}

function codeList(values: readonly string[]): string {
  return values.map(code).join(", ");
}

function formatDefault(value: unknown): string {
  return code(JSON.stringify(value));
}

function describeType(definition: SettingDefinition): string {
  switch (definition.kind) {
    case "boolean":
      return "boolean";
    case "string":
      return "string";
    case "string-safe":
      return "string — empty, or a CSS-safe identifier (letters, digits, `_`, `-`, not starting with a digit)";
    case "enum":
      return `one of ${codeList(definition.values ?? [])}`;
    case "enum-array":
      return `array of ${codeList(definition.values ?? [])}`;
    case "integer": {
      const { min, max } = definition;
      if (min !== undefined && max !== undefined) return `integer, ${min}–${max}`;
      if (min !== undefined) return `integer, minimum ${min}`;
      if (max !== undefined) return `integer, maximum ${max}`;
      return "integer";
    }
    case "positive-integer":
      return "positive integer";
    case "positive-integer-nullable":
      return "positive integer, or `null`";
    case "positive-number-nullable":
      return "positive number, or `null`";
  }
}

const STATUS_LABELS: Record<SettingSupportStatus, string> = {
  honored: "yes",
  partial: "partial",
  unsupported: "**no**",
  na: "n/a",
};

function supportFor(surface: SurfaceCapabilities, key: string): SettingSupport {
  return (
    surface.settings[key] ?? {
      status: surface.defaultStatus,
      note: surface.defaultNote,
    }
  );
}

/** True when the surface has no per-setting entry and inherits its default. */
function isFallback(surface: SurfaceCapabilities, key: string): boolean {
  return surface.settings[key] === undefined;
}

/**
 * The full "what actually happens" sentence for one cell: the declared note
 * plus every machine-readable qualifier that narrows it.
 */
function describeSupport(support: SettingSupport): string {
  const parts: string[] = [];

  if (support.values) {
    parts.push(`Honored values: ${codeList(support.values)}.`);
  }
  if (support.paths) {
    parts.push(`Honored on the ${codeList(support.paths)} path only.`);
  }
  if (support.unsupportedFormats) {
    parts.push(`Not honored for the ${codeList(support.unsupportedFormats)} format.`);
  }
  if ("divergesAtDefault" in support) {
    parts.push(
      support.divergesAtDefault === null
        ? "There is no equivalent behavior here, so any value diverges."
        : `This surface behaves as ${code(JSON.stringify(support.divergesAtDefault))}, whatever you set.`,
    );
  }
  if (support.note) parts.push(support.note);
  if (support.warnedByEmitter) {
    parts.push(`Warned per affected element with the code ${code(support.warnedByEmitter)}.`);
  }

  return parts.join(" ");
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Settings reference                                                  */
/* ------------------------------------------------------------------ */

const DEFAULT_STATUS_WORDS: Record<SettingSupportStatus, string> = {
  honored: "honored",
  partial: "partially honored",
  unsupported: "not honored",
  na: "n/a — never reached",
};

function renderSurfacesSection(): string {
  const rows = surfaces.map((surface) => [
    surfaceName(surface),
    DEFAULT_STATUS_WORDS[surface.defaultStatus],
    surface.runtimeChecked ? "yes" : "**no** — the declaration is documentation only",
    surface.defaultNote || "—",
  ]);

  return [
    "## Surfaces",
    "",
    "Every setting below is scored against these five surfaces. A surface with no explicit entry for a setting behaves as its default column says.",
    "",
    table(
      ["Surface", "Settings it does not name", "Warns you at export time?", "Surface note"],
      rows,
    ),
    "",
    "A surface that warns tells you, during the export itself, whenever you asked for something it will not produce. A surface that does not warn will simply do something else in silence.",
  ].join("\n");
}

function renderKeySection(): string {
  return [
    "## Support Key",
    "",
    table(
      ["Value", "Meaning"],
      [
        ["yes", "Read and acted on."],
        [
          "partial",
          "Acted on for some values, entry paths, or output formats only. See the setting's own section.",
        ],
        ["**no**", "The surface accepts the setting and does nothing with it."],
        ["n/a", "Meaningless here — the surface never reaches the code the setting drives."],
      ],
    ),
  ].join("\n");
}

function renderGlanceTable(): string {
  const rows = definitions.map((definition) => {
    const key = definition.key as string;
    return [
      `[${code(key)}](#${key})`,
      ...surfaces.map((surface) => STATUS_LABELS[supportFor(surface, key).status]),
    ];
  });

  return ["## Support At A Glance", "", table(["Setting", ...surfaceNames], rows)].join("\n");
}

function renderSettingSection(definition: SettingDefinition): string {
  const key = definition.key as string;
  const help = getSettingHelpDefinition(key);
  const description = help?.summary ?? EXTRA_DESCRIPTIONS[key];
  if (!description) {
    throw new Error(
      `Setting "${key}" has no description. Add an entry in src/ir/setting-help.ts, ` +
        "or an entry in EXTRA_DESCRIPTIONS in scripts/generate-settings-docs.ts.",
    );
  }

  const facts = [
    `**Type:** ${describeType(definition)}`,
    `**Default:** ${formatDefault(definition.defaultValue)}`,
  ];
  if (help) facts.push(`**Panel label:** ${code(help.label)}`);

  const lines = [
    // Explicit anchor: the CEP panel deep-links to /reference/settings/#<key>
    // (plugins/illustrator/panel/src/js/setting-help.ts), and heading slugs are
    // lowercased by the site generator, which would break every camelCase key.
    `<a id="${key}"></a>`,
    `### ${code(key)}`,
    "",
    facts.join(" · "),
    "",
    description,
  ];

  if (help?.details) lines.push("", help.details);
  if (help?.defaultNote) lines.push("", help.defaultNote);

  if (help?.optionNotes) {
    lines.push("");
    for (const [option, note] of Object.entries(help.optionNotes)) {
      lines.push(`- **${option}** — ${note}`);
    }
  }

  const notable = surfaces.filter((surface) => {
    const support = supportFor(surface, key);
    return support.status !== "honored" || support.paths || support.unsupportedFormats;
  });
  const honored = surfaces.filter((surface) => !notable.includes(surface));

  lines.push("");
  if (notable.length === 0) {
    lines.push("Honored on every surface.");
  } else {
    if (honored.length > 0) {
      lines.push(`Honored on: ${honored.map(surfaceName).join(", ")}.`);
      lines.push("");
    }
    lines.push(
      table(
        ["Surface", "Support", "What actually happens"],
        notable.map((surface) => {
          const support = supportFor(surface, key);
          // A fallback cell repeats the same surface-wide sentence for every
          // setting, so link to it once instead of printing it 33 times.
          const detail = isFallback(surface, key)
            ? "Surface default — see [Surfaces](#surfaces)."
            : describeSupport(support);
          return [surfaceName(surface), STATUS_LABELS[support.status], detail || "—"];
        }),
      ),
    );
  }

  return lines.join("\n");
}

function renderNotSettingsSection(): string {
  const metadataKeys = Object.keys(MetadataSchema.shape);
  return [
    "## Not Settings",
    "",
    "These keys are frequently mistaken for settings. They live in `metadata` on the IR document, not in `settings`, and setting them under `settings` does nothing:",
    "",
    metadataKeys.map((key) => `- ${code(key)}`).join("\n"),
    "",
    "`metadata` also accepts arbitrary extra keys. The core pipeline never reads them; they are passthrough for emitters and downstream consumers.",
  ].join("\n");
}

function buildSettingsDoc(): string {
  const sections = [
    [
      "---",
      "title: Settings Reference",
      "description: Every canonical setting, its type, its default, and which surfaces actually honor it.",
      "---",
    ].join("\n"),
    GENERATED_BANNER,
    "# Settings Reference",
    "all2html keeps one canonical settings model even though each source tool exposes it differently. This page is generated from the setting definitions and the per-surface capability declarations in the source tree, so it cannot describe behavior the code does not have.",
    "Settings always use canonical camelCase keys inside the IR and in `all2html.config.json`. Tool-native spellings such as `image_format` or `html_output_path` are accepted only on the tool side of the boundary — in an Illustrator `ai2html-settings` text block — and are normalized before they reach the pipeline.",
    `There are ${definitions.length} settings.`,
    renderSurfacesSection(),
    renderKeySection(),
    renderGlanceTable(),
    "## Settings",
    ...definitions.map(renderSettingSection),
    renderNotSettingsSection(),
    [
      "## Where Settings Come From",
      "",
      "Depending on the surface, settings can arrive from a document text block, a config file, panel UI state, plugin UI controls, or CLI config. They all resolve into the same settings object before anything is emitted.",
      "",
      "See also: [Support Matrix](support-matrix.md) for output formats and special-layer tags per surface.",
    ].join("\n"),
  ];

  return `${sections.join("\n\n")}\n`;
}

/* ------------------------------------------------------------------ */
/* Support matrix                                                      */
/* ------------------------------------------------------------------ */

const FEATURE_STATUS_LABELS: Record<string, string> = {
  honored: "yes",
  unsupported: "**no**",
  na: "n/a",
};

function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? code(key);
}

/** Every feature key any surface declares, in first-declared order. */
function allFeatureKeys(): string[] {
  const seen: string[] = [];
  for (const surface of surfaces) {
    for (const key of Object.keys(getSurfaceFeatures(surface.surface))) {
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

function renderFeatureTable(
  keys: readonly string[],
  extraColumn?: (key: string) => string,
): string {
  const headers = extraColumn
    ? ["Feature", "Written as", ...surfaceNames]
    : ["Feature", ...surfaceNames];

  const rows = keys.map((key) => {
    const cells = surfaces.map((surface) => {
      const support = getSurfaceFeatures(surface.surface)[key];
      if (!support) return "—";
      const label = FEATURE_STATUS_LABELS[support.status] ?? support.status;
      return support.note ? `${label} ¹` : label;
    });
    return extraColumn
      ? [featureLabel(key), extraColumn(key), ...cells]
      : [featureLabel(key), ...cells];
  });

  return table(headers, rows);
}

/** Every non-empty note behind a `¹` marker, so the table stays readable. */
function renderFeatureNotes(keys: readonly string[]): string {
  const lines: string[] = [];
  for (const key of keys) {
    for (const surface of surfaces) {
      const support = getSurfaceFeatures(surface.surface)[key];
      if (!support?.note) continue;
      lines.push(`- **${featureLabel(key)} · ${surfaceName(surface)}** — ${support.note}`);
    }
  }
  return lines.length > 0 ? `¹ Details:\n\n${lines.join("\n")}` : "";
}

function renderFeatureSection(
  title: string,
  intro: string,
  keys: readonly string[],
  withSpelling: boolean,
): string {
  if (keys.length === 0) return "";
  const parts = [
    `## ${title}`,
    "",
    intro,
    "",
    renderFeatureTable(keys, withSpelling ? (key) => TAG_SPELLINGS[key] ?? "—" : undefined),
  ];
  const notes = renderFeatureNotes(keys);
  if (notes) parts.push("", notes);
  return parts.join("\n");
}

/**
 * Exact per-surface tag grammar. This is prose because the grammar is not
 * declared as data anywhere — it lives in three parsers with three different
 * rules, and the divergence is the reason the hand-written docs were wrong.
 * Line references are the parsers themselves; check them before editing.
 */
const TAG_SYNTAX_NOTES = [
  "## Exact Tag Syntax",
  "",
  "The three surfaces parse layer names with three different grammars. A tag that works in one may silently match nothing in another — nothing errors, the layer just exports as ordinary artwork.",
  "",
  "**Illustrator** (`plugins/illustrator/exporter.jsx`) splits the layer name on the **first** `:`, lowercases the remainder, and matches it exactly with no trimming.",
  "",
  "- Inline SVG is written `:svg,inline` **or** `:inline` — a comma, not a second colon.",
  "- Artboard names use a separate grammar: `name:token,token`, `key=value`, or a bare integer width.",
  "",
  "**Figma** (`plugins/figma/src/extract/layers.ts`) matches case-insensitively as a prefix **or** a suffix of the node name, first match wins, and only scans direct children of the selected frame.",
  "",
  "- Inline SVG is written `:svg:inline` **only**. `:svg,inline` and `:inline` do not match.",
  "- Frame tokens are `:dynamic`, `:fixed`, `:image` (not `:image-only`), or a bare integer width override.",
  "",
  "**SVG import** (`src/importers/svg/import-core.ts`) has **no layer tags at all**. Every layer imports as an ordinary layer. Grouping and rendering come from the filename stem instead: `--dynamic` / `:dynamic`, `--image` / `:image`, and `--<width>` / `:<width>`.",
  "",
  "The rows above marked yes for the CLI and browser converter mean the emitters honor the tag when it is already present in the IR — for example in IR produced by Illustrator. The SVG importer never produces one.",
].join("\n");

function buildSupportMatrixDoc(): string {
  const keys = allFeatureKeys();
  const formatKeys = keys.filter((key) => key.startsWith("format:"));
  const tagKeys = keys.filter((key) => key.startsWith("tag:"));
  const otherKeys = keys.filter((key) => !key.startsWith("format:") && !key.startsWith("tag:"));

  const sections = [
    [
      "---",
      "title: Support Matrix",
      "description: What works where — output formats, special-layer tags, and features per export surface.",
      "---",
    ].join("\n"),
    GENERATED_BANNER,
    "# Support Matrix",
    "What each export surface can actually produce. Generated from the capability declarations in `src/core/capabilities.ts`, so it reflects the code rather than the roadmap.",
    [
      "**yes** means the surface does it. **no** means the surface accepts or exposes it and does nothing with it. **n/a** means it is meaningless there. **—** means the surface makes no declaration for that feature.",
      "",
      "For per-setting support, see the [Settings Reference](settings.md). For how finished each surface is, see [Install](../install.md).",
    ].join("\n"),
    renderFeatureSection(
      "Output Formats",
      "Which emitters each surface can actually run.",
      formatKeys,
      false,
    ),
    renderFeatureSection(
      "Special Layer Tags",
      "Tagged layers become overlays or HTML hooks instead of being baked into the background raster. **The spelling is not the same on every surface** — read the syntax notes below before copying a tag between tools.",
      tagKeys,
      true,
    ),
    TAG_SYNTAX_NOTES,
    renderFeatureSection(
      "Other Features",
      "Everything else the surfaces differ on.",
      otherKeys,
      false,
    ),
  ].filter((section) => section.length > 0);

  return `${sections.join("\n\n")}\n`;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

interface GeneratedDoc {
  path: string;
  contents: string;
}

function generate(): GeneratedDoc[] {
  return [
    { path: SETTINGS_DOC_PATH, contents: buildSettingsDoc() },
    { path: SUPPORT_MATRIX_DOC_PATH, contents: buildSupportMatrixDoc() },
  ];
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function main(): void {
  const checkOnly = process.argv.includes("--check");
  const docs = generate();
  const stale: string[] = [];

  for (const doc of docs) {
    const relativePath = relative(rootDir, doc.path);
    if (checkOnly) {
      const current = readIfPresent(doc.path);
      if (current === doc.contents) {
        console.log(`ok      ${relativePath}`);
      } else {
        console.log(`STALE   ${relativePath}`);
        stale.push(relativePath);
      }
      continue;
    }
    writeFileSync(doc.path, doc.contents);
    console.log(`wrote   ${relativePath}`);
  }

  if (stale.length > 0) {
    console.error(
      `\n${stale.length} generated doc(s) are out of date with the source declarations.\n` +
        "Run `pnpm docs:generate` and commit the result.",
    );
    process.exit(1);
  }
}

main();
