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
  { key: "writeImageFiles", defaultValue: true, kind: "boolean" },
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
  { key: "inlineSvg", defaultValue: false, kind: "boolean" },
  { key: "svgIdPrefix", defaultValue: "", kind: "string-safe" },
  { key: "svgEmbedImages", defaultValue: false, kind: "boolean" },
  { key: "clickableLink", defaultValue: "", kind: "string" },
  { key: "createPromoImage", defaultValue: false, kind: "boolean" },
  { key: "promoImageWidth", defaultValue: 1024, kind: "positive-integer" },
  { key: "localPreviewTemplate", defaultValue: "", kind: "string" },
] as const satisfies readonly SettingDefinition[];

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
