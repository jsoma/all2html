import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";
import type { EmitterConfig } from "../emitters/types.js";
import { EmitterConfigSchema } from "../emitters/types.js";
import type { FontMapping, Settings } from "../ir/types.js";

const ConfigFontMappingSchema = z.object({
  aifont: z.string().min(1),
  family: z.string().min(1),
  weight: z.string().optional(),
  style: z.string().optional(),
  vshift: z.string().optional(),
});

const ConfigImageFormatSchema = z.enum(["auto", "png", "png24", "jpg", "svg"]);

const ConfigSettingsSchema = z
  .object({
    imageFormat: z.array(ConfigImageFormatSchema),
    writeImageFiles: z.boolean(),
    pngTransparent: z.boolean(),
    pngNumberOfColors: z.number().int().min(1).max(256),
    jpgQuality: z.number().int().min(0).max(100),
    use2xImages: z.boolean(),
    cacheBustToken: z.number().int().positive().nullable(),
    namespace: z.string(),
    projectName: z.string(),
    output: z.enum(["one-file", "multiple-files"]),
    htmlOutputPath: z.string(),
    htmlOutputExtension: z.string(),
    imageOutputPath: z.string(),
    imageSourcePath: z.string(),
    responsiveness: z.enum(["fixed", "dynamic"]),
    textResponsiveness: z.enum(["fixed", "dynamic"]),
    maxWidth: z.number().positive().nullable(),
    centerHtmlOutput: z.boolean(),
    renderTextAs: z.enum(["html", "image"]),
    renderRotatedSkewedTextAs: z.enum(["html", "image"]),
    testingMode: z.boolean(),
    includeResizerCss: z.boolean(),
    includeResizerWidths: z.boolean(),
    responsiveImageMode: z.enum(["img-src", "css-var"]),
    useLazyLoader: z.boolean(),
    inlineSvg: z.boolean(),
    svgIdPrefix: z.string(),
    svgEmbedImages: z.boolean(),
    clickableLink: z.string(),
    createPromoImage: z.boolean(),
    promoImageWidth: z.number().int().positive(),
    localPreviewTemplate: z.string(),
  })
  .partial();

export const All2HtmlConfigSchema = z
  .object({
    fonts: z.array(ConfigFontMappingSchema).optional(),
    settings: ConfigSettingsSchema.optional(),
    emit: EmitterConfigSchema,
  })
  .strict();

export type All2HtmlConfig = z.infer<typeof All2HtmlConfigSchema>;

function formatParseErrors(errors: ParseError[]): string {
  return errors
    .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
    .join("; ");
}

function formatSchemaError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export function parseConfigText(
  raw: string,
  sourceLabel: string = "inline config",
): All2HtmlConfig {
  const parseErrors: ParseError[] = [];
  const parsed = parseJsonc(raw, parseErrors);
  if (parseErrors.length > 0) {
    throw new Error(`Invalid config file "${sourceLabel}": ${formatParseErrors(parseErrors)}`);
  }

  const validated = All2HtmlConfigSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Invalid config file "${sourceLabel}": ${formatSchemaError(validated.error)}`);
  }

  return validated.data;
}

export function getConfigSettings(config?: All2HtmlConfig): Partial<Settings> | undefined {
  return config?.settings;
}

export function getConfigFonts(config?: All2HtmlConfig): FontMapping[] | undefined {
  return config?.fonts;
}

export function getEmitterConfig(config?: All2HtmlConfig): EmitterConfig | undefined {
  return config?.emit;
}
