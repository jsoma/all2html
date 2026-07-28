import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";
import type { EmitterConfig } from "../emitters/types.js";
import { EmitterConfigSchema } from "../emitters/types.js";
import { SettingsSchema } from "../ir/schema.js";
import type { FontMapping, Settings } from "../ir/types.js";

const ConfigFontMappingSchema = z
  .object({
    sourceFont: z.string().min(1).optional(),
    aifont: z.string().min(1).optional(),
    family: z.string().min(1),
    weight: z.string().optional(),
    style: z.string().optional(),
    vshift: z.string().optional(),
  })
  // Strict like the top-level config: a typo inside a font entry used to be
  // silently stripped while the rest of the file was validated.
  .strict()
  .refine((font) => font.sourceFont || font.aifont, {
    path: ["sourceFont"],
    message: "sourceFont is required",
  })
  // `aifont` is a compatibility alias for `sourceFont`, not a second field.
  // When both are present they must agree — silently letting `sourceFont` win
  // hid the conflict from the one person who could resolve it.
  .refine((font) => !font.sourceFont || !font.aifont || font.sourceFont === font.aifont, {
    path: ["aifont"],
    message: "aifont conflicts with sourceFont; the two must match when both are present",
  })
  .transform(({ aifont, sourceFont, ...font }): FontMapping => {
    const normalizedSourceFont = sourceFont ?? aifont;
    if (!normalizedSourceFont) {
      throw new Error("sourceFont is required");
    }
    return {
      sourceFont: normalizedSourceFont,
      ...font,
    };
  });

export const All2HtmlConfigSchema = z
  .object({
    fonts: z.array(ConfigFontMappingSchema).optional(),
    settings: SettingsSchema.optional(),
    emit: EmitterConfigSchema.optional().default({}),
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

/**
 * The one config validator. `parseConfigText` is JSONC parsing plus this; the
 * pipeline calls it directly on the object a surface hands in as inline config,
 * so a JS caller passing junk fails here with a named path instead of deep in a
 * transform. There is deliberately no second schema anywhere.
 */
export function parseConfigObject(
  input: unknown,
  sourceLabel: string = "inline config",
): All2HtmlConfig {
  const validated = All2HtmlConfigSchema.safeParse(input);
  if (!validated.success) {
    throw new Error(`Invalid config file "${sourceLabel}": ${formatSchemaError(validated.error)}`);
  }

  return validated.data;
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

  return parseConfigObject(parsed, sourceLabel);
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
