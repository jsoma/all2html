import { z } from "zod";

const commonEmitterOptionShape = {
  positionMode: z.enum(["percentage", "absolute"]).optional(),
  /** When false, all binding.allowHtml annotations are treated as plain text.
   *  Defaults to true for ai2html parity. Set to false to prevent XSS in untrusted CMS data. */
  allowUnsafeHtml: z.boolean().optional(),
  responsiveImageMode: z.enum(["img-src", "css-var"]).optional(),
};

// Base emitter options shared across all formats
export const EmitterOptionsSchema = z.object(commonEmitterOptionShape).strict().optional();

export const SvelteEmitterOptionsSchema = z.object(commonEmitterOptionShape).strict().optional();

export const ReactEmitterOptionsSchema = z
  .object({
    ...commonEmitterOptionShape,
    typescript: z.boolean().optional(),
  })
  .strict()
  .optional();

export const EmitterConfigSchema = z
  .object({
    html: EmitterOptionsSchema,
    svelte: SvelteEmitterOptionsSchema,
    react: ReactEmitterOptionsSchema,
    standalone: EmitterOptionsSchema,
  })
  .strict()
  .optional();

export type EmitterOptions = z.infer<typeof EmitterOptionsSchema>;
export type SvelteEmitterOptions = z.infer<typeof SvelteEmitterOptionsSchema>;
export type ReactEmitterOptions = z.infer<typeof ReactEmitterOptionsSchema>;
export type EmitterConfig = z.infer<typeof EmitterConfigSchema>;
