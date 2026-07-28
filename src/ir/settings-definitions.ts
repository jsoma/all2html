import type { ImageFormat, Settings } from "./types.js";

export type SettingDefinitionKind =
  | "boolean"
  | "string"
  | "string-safe"
  | "enum"
  | "enum-array"
  | "integer"
  | "positive-integer"
  | "positive-integer-nullable"
  | "positive-number-nullable";

export interface SettingDefinition {
  key: keyof Settings;
  defaultValue: Settings[keyof Settings];
  kind: SettingDefinitionKind;
  values?: readonly string[];
  min?: number;
  max?: number;
}

const IMAGE_FORMAT_VALUES = ["auto", "png", "png24", "jpg", "svg"] as const;
const OUTPUT_VALUES = ["one-file", "multiple-files"] as const;
const RESPONSIVENESS_VALUES = ["fixed", "dynamic"] as const;
const TEXT_RENDER_VALUES = ["html", "image"] as const;
const GOOGLE_FONTS_VALUES = ["none", "import", "link"] as const;
const RESPONSIVE_IMAGE_MODE_VALUES = ["img-src", "css-var"] as const;

export const SETTING_DEFINITIONS = [
  {
    key: "imageFormat",
    defaultValue: ["auto"] as ImageFormat[],
    kind: "enum-array",
    values: IMAGE_FORMAT_VALUES,
  },
  { key: "pngTransparent", defaultValue: false, kind: "boolean" },
  { key: "pngNumberOfColors", defaultValue: 128, kind: "integer", min: 1, max: 256 },
  { key: "jpgQuality", defaultValue: 85, kind: "integer", min: 0, max: 100 },
  { key: "use2xImages", defaultValue: true, kind: "boolean" },
  { key: "cacheBustToken", defaultValue: null, kind: "positive-integer-nullable" },
  { key: "namespace", defaultValue: "g-", kind: "string-safe" },
  { key: "projectName", defaultValue: "", kind: "string-safe" },
  { key: "output", defaultValue: "one-file", kind: "enum", values: OUTPUT_VALUES },
  { key: "htmlOutputPath", defaultValue: "all2html-output/", kind: "string" },
  { key: "htmlOutputExtension", defaultValue: ".html", kind: "string" },
  { key: "imageOutputPath", defaultValue: "all2html-output/", kind: "string" },
  { key: "imageSourcePath", defaultValue: "", kind: "string" },
  { key: "responsiveness", defaultValue: "fixed", kind: "enum", values: RESPONSIVENESS_VALUES },
  {
    key: "textResponsiveness",
    defaultValue: "dynamic",
    kind: "enum",
    values: RESPONSIVENESS_VALUES,
  },
  { key: "maxWidth", defaultValue: null, kind: "positive-number-nullable" },
  { key: "centerHtmlOutput", defaultValue: true, kind: "boolean" },
  { key: "renderTextAs", defaultValue: "html", kind: "enum", values: TEXT_RENDER_VALUES },
  {
    key: "renderRotatedSkewedTextAs",
    defaultValue: "html",
    kind: "enum",
    values: TEXT_RENDER_VALUES,
  },
  { key: "googleFonts", defaultValue: "none", kind: "enum", values: GOOGLE_FONTS_VALUES },
  { key: "testingMode", defaultValue: false, kind: "boolean" },
  { key: "includeResizerCss", defaultValue: true, kind: "boolean" },
  { key: "includeResizerWidths", defaultValue: true, kind: "boolean" },
  {
    key: "responsiveImageMode",
    defaultValue: "img-src",
    kind: "enum",
    values: RESPONSIVE_IMAGE_MODE_VALUES,
  },
  { key: "useLazyLoader", defaultValue: true, kind: "boolean" },
  { key: "svgEmbedImages", defaultValue: false, kind: "boolean" },
  { key: "clickableLink", defaultValue: "", kind: "string" },
  { key: "createPromoImage", defaultValue: false, kind: "boolean" },
  { key: "promoImageWidth", defaultValue: 1024, kind: "positive-integer" },
  { key: "localPreviewTemplate", defaultValue: "", kind: "string" },
] as const satisfies readonly SettingDefinition[];

/**
 * The rule for `string-safe` settings (`namespace`, `projectName`):
 * they are concatenated into CSS selectors and generated identifiers
 * **unescaped**, so any metacharacter is an injection vector.
 *
 * It lives here, next to the `string-safe` kind it defines, rather than in
 * `schema.ts`, because `schema.ts` imports Zod and the ExtendScript bundle must
 * apply the identical rule without dragging Zod into Illustrator. `schema.ts`
 * re-exports it so there is exactly one pattern, not two that can drift.
 */
export const SAFE_SETTING_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** The settings declared `string-safe`, derived from the table rather than restated. */
export type SafeIdentifierSettingKey = Extract<
  (typeof SETTING_DEFINITIONS)[number],
  { kind: "string-safe" }
>["key"];

// A plain loop, not `filter().map()`: this runs at module-evaluation time, and in
// the ExtendScript bundle every imported module body executes *before*
// `installPolyfills()` in `src/extendscript/index.ts`. ES3 has neither method.
function collectSafeIdentifierSettingKeys(): SafeIdentifierSettingKey[] {
  const keys: SafeIdentifierSettingKey[] = [];
  for (let i = 0; i < SETTING_DEFINITIONS.length; i++) {
    const definition = SETTING_DEFINITIONS[i];
    if (definition.kind === "string-safe") keys.push(definition.key);
  }
  return keys;
}

/** Setting keys whose values must satisfy `SAFE_SETTING_IDENTIFIER_RE` (or be empty). */
export const SAFE_IDENTIFIER_SETTING_KEYS: readonly SafeIdentifierSettingKey[] =
  collectSafeIdentifierSettingKeys();

function isArrayValue(value: unknown): value is unknown[] {
  return Object.prototype.toString.call(value) === "[object Array]";
}

export function createDefaultSettings(): Settings {
  const result: Partial<Settings> = {};
  for (const definition of SETTING_DEFINITIONS) {
    const value = definition.defaultValue;
    result[definition.key] = isArrayValue(value) ? ([...value] as never) : (value as never);
  }
  return result as Settings;
}

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTING_DEFINITIONS.find((definition) => definition.key === key);
}

export function getSettingDefault<K extends keyof Settings>(key: K): Settings[K] {
  const definition = getSettingDefinition(key);
  if (!definition) {
    throw new Error(`Unknown setting: ${String(key)}`);
  }
  const value = definition.defaultValue;
  return (isArrayValue(value) ? [...value] : value) as Settings[K];
}

function isFiniteNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    value > Number.NEGATIVE_INFINITY &&
    value < Number.POSITIVE_INFINITY
  );
}

function isDeclaredValue(value: unknown, values: readonly string[] | undefined): boolean {
  if (typeof value !== "string" || !values) return false;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === value) return true;
  }
  return false;
}

/**
 * Zod-free runtime validation generated from the same setting definitions as
 * `SettingsSchema`. Illustrator calls this before persisting IR and the
 * ExtendScript core calls it again after settings precedence is resolved.
 */
export function isValidSettingValue(key: string, value: unknown): boolean {
  const definition = getSettingDefinition(key);
  if (!definition) return false;

  switch (definition.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "string-safe":
      return typeof value === "string" && (value === "" || SAFE_SETTING_IDENTIFIER_RE.test(value));
    case "enum":
      return isDeclaredValue(value, definition.values);
    case "enum-array":
      if (!isArrayValue(value)) return false;
      for (let i = 0; i < value.length; i++) {
        if (!isDeclaredValue(value[i], definition.values)) return false;
      }
      return true;
    case "integer":
      return (
        isFiniteNumber(value) &&
        Math.floor(value) === value &&
        (definition.min === undefined || value >= definition.min) &&
        (definition.max === undefined || value <= definition.max)
      );
    case "positive-integer":
      return isFiniteNumber(value) && Math.floor(value) === value && value > 0;
    case "positive-integer-nullable":
      return value === null || (isFiniteNumber(value) && Math.floor(value) === value && value > 0);
    case "positive-number-nullable":
      return value === null || (isFiniteNumber(value) && value > 0);
  }
}
