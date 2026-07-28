import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";
import { EmitterConfigSchema } from "../../../src/emitters/types.js";
import { FontMappingSchema, MetadataSchema, SettingsSchema } from "../../../src/ir/schema.js";
import { FigmaPluginError } from "./errors.js";
import type { FigmaPluginConfig } from "./types.js";

const FigmaPluginConfigSchema = z
  .object({
    settings: SettingsSchema.optional(),
    metadata: MetadataSchema.partial().optional(),
    fonts: z.array(FontMappingSchema).optional(),
    customBlocks: z
      .array(
        z.object({
          type: z.enum(["css", "js", "html", "html-before", "html-after"]),
          content: z.string(),
        }),
      )
      .optional(),
    // The canonical emitter-options block, byte-for-byte the schema the CLI
    // reads from `all2html.config.json`. Reusing it keeps the config thin: no
    // Figma-specific emitter contract exists, and shipped emitter features are
    // otherwise unreachable from this surface.
    emit: EmitterConfigSchema,
  })
  .strict();

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

export function parsePluginConfig(raw: string | undefined): FigmaPluginConfig {
  if (!raw || raw.trim() === "") {
    return {};
  }

  const parseErrors: ParseError[] = [];
  const parsed = parseJsonc(raw, parseErrors);
  if (parseErrors.length > 0) {
    throw new FigmaPluginError(`Invalid Figma config JSONC: ${formatParseErrors(parseErrors)}`);
  }

  const validated = FigmaPluginConfigSchema.safeParse(parsed);
  if (!validated.success) {
    throw new FigmaPluginError(`Invalid Figma config: ${formatSchemaError(validated.error)}`);
  }

  return validated.data;
}
