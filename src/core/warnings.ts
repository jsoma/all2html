/**
 * Structured warnings.
 *
 * A warning carries a stable machine-readable `code` and a `category` assigned
 * **at the call site**, plus the human `message` and whatever context the
 * producer knows (artboard / layer / element / setting / surface).
 *
 * Grouping, truncation, and presentation are then presentation decisions.
 * Nothing in this module inspects English prose — the previous implementation
 * classified warnings with `message.includes("font")`, which silently filed
 * "Found a text element with no fill color" under `other`.
 *
 * ES3-safe: no `Map`, no `Set`, no `Object.entries` beyond the polyfills. This
 * module ships inside the ExtendScript bundle.
 */

/** Presentation bucket. Assigned at the call site alongside the code. */
export type WarningCategory =
  | "font"
  | "text"
  | "image"
  | "geometry"
  | "markup"
  | "setting"
  | "template"
  | "other";

/**
 * A surface is a place a user drives an export from. Declarations for each one
 * live in `src/core/capabilities.ts`.
 *
 * `browser` is the dropzone. It is a variant of `cli` and diverges in exactly
 * one place today (`localPreviewTemplate`), which is why it is its own id.
 */
export type SurfaceId = "illustrator" | "after-effects" | "figma" | "cli" | "browser";

/** Which entry point of a surface is running. Some settings are honored on one. */
export type SurfacePath = "render" | "import";

export interface WarningContext {
  artboardId?: string;
  layerId?: string;
  elementId?: string;
  /** The `Settings` key this warning is about, when it is about one. */
  setting?: string;
  surface?: SurfaceId;
}

export interface StructuredWarning extends WarningContext {
  /** Stable machine-readable identifier, e.g. `font:unmapped`. Never derived from the message. */
  code: string;
  category: WarningCategory;
  message: string;
}

export function createWarning(
  code: string,
  category: WarningCategory,
  message: string,
  context?: WarningContext,
): StructuredWarning {
  const warning: StructuredWarning = { code: code, category: category, message: message };
  if (!context) return warning;
  if (context.artboardId !== undefined) warning.artboardId = context.artboardId;
  if (context.layerId !== undefined) warning.layerId = context.layerId;
  if (context.elementId !== undefined) warning.elementId = context.elementId;
  if (context.setting !== undefined) warning.setting = context.setting;
  if (context.surface !== undefined) warning.surface = context.surface;
  return warning;
}

/**
 * The plain-string projection. Every public result keeps a `warnings: string[]`
 * built from this so existing consumers (manifest.json, the panel, the Figma UI,
 * the CLI) are unaffected by the structured representation.
 */
export function warningMessages(warnings: readonly StructuredWarning[]): string[] {
  const messages: string[] = [];
  for (let i = 0; i < warnings.length; i++) messages.push(warnings[i].message);
  return messages;
}

/** Append `warning` unless an identical code+message pair is already recorded. */
export function pushUniqueStructuredWarning(
  warnings: StructuredWarning[],
  warning: StructuredWarning,
): void {
  for (let i = 0; i < warnings.length; i++) {
    if (warnings[i].code === warning.code && warnings[i].message === warning.message) return;
  }
  warnings.push(warning);
}

export interface WarningGroup {
  category: WarningCategory;
  warnings: StructuredWarning[];
}

/** Fixed display order, so grouped output is deterministic. */
export const WARNING_CATEGORY_ORDER: readonly WarningCategory[] = [
  "setting",
  "font",
  "text",
  "image",
  "geometry",
  "markup",
  "template",
  "other",
];

const CATEGORY_LABELS: { [key: string]: string } = {
  setting: "Settings",
  font: "Fonts",
  text: "Text",
  image: "Images",
  geometry: "Geometry",
  markup: "Markup",
  template: "Templates",
  other: "Other",
};

/**
 * Group by the declared `category`. Replaces the substring classifier that used
 * to live here; see `internal-docs/product-decisions.md` D16.
 */
export function groupWarnings(warnings: readonly StructuredWarning[]): WarningGroup[] {
  const groups: WarningGroup[] = [];
  for (let i = 0; i < WARNING_CATEGORY_ORDER.length; i++) {
    const category = WARNING_CATEGORY_ORDER[i];
    const matched: StructuredWarning[] = [];
    for (let j = 0; j < warnings.length; j++) {
      if (warnings[j].category === category) matched.push(warnings[j]);
    }
    if (matched.length > 0) groups.push({ category: category, warnings: matched });
  }
  return groups;
}

export function formatGroupedWarnings(groups: readonly WarningGroup[]): string {
  const sections: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const label = CATEGORY_LABELS[group.category] || group.category;
    sections.push(label + " (" + group.warnings.length + "):");
    for (let j = 0; j < group.warnings.length; j++) {
      sections.push("  [" + group.warnings[j].code + "] " + group.warnings[j].message);
    }
  }
  return sections.join("\n");
}
