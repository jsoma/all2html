import { z } from "zod";

/**
 * The emitter options a **user** may write in `all2html.config.json` (or the
 * Figma plugin's `emit` block). Everything here is a preference about the
 * output, not a statement about where the output lands.
 */
const commonEmitterOptionShape = {
  positionMode: z.enum(["percentage", "absolute"]).optional(),
  /** When false, all binding.allowHtml annotations are treated as plain text.
   *  Defaults to true for ai2html parity. Set to false to prevent XSS in untrusted CMS data. */
  allowUnsafeHtml: z.boolean().optional(),
  responsiveImageMode: z.enum(["img-src", "css-var"]).optional(),
};

/**
 * `assetBase` — the path from the **emitted file** to the assets it references,
 * used as the prefix of every `<img src>` / CSS `url()` the emitters produce.
 *
 * This is a **layout fact supplied by the surface**, not a user setting. Only
 * the surface knows where it writes the emitted file relative to the images:
 *
 *   - Illustrator writes the HTML and its images into one directory, so the
 *     prefix is `""` and every `src` is a bare filename.
 *   - The bundle-producing surfaces (CLI, browser dropzone, Figma ZIP) put the
 *     emitted files at the bundle root and the assets under
 *     `settings.imageOutputPath`, so the prefix is that directory — the same
 *     value they hand `createOutputBundle({ assetRoot })`, which is what keeps
 *     the emitted `src` and the bundle entry in agreement.
 *
 * It is deliberately absent from `EmitterConfigSchema` below, which is
 * `.strict()`: a config file that names `assetBase` is a parse error rather
 * than a silently honored path. The user-facing control over the `src` prefix
 * is `settings.imageSourcePath`, which overrides this entirely (ai2html's own
 * split — `image_output_path` is a filesystem directory, `image_source_path` is
 * the `<img src>` prefix, and the NYT configs set them to different values).
 */
const surfaceLayoutOptionShape = {
  assetBase: z.string().optional(),
};

/** User-config shape: no surface layout facts. */
const ConfigEmitterOptionsSchema = z.object(commonEmitterOptionShape).strict().optional();

const ConfigReactEmitterOptionsSchema = z
  .object({
    ...commonEmitterOptionShape,
    typescript: z.boolean().optional(),
  })
  .strict()
  .optional();

// Base emitter options shared across all formats, as the emitters receive them:
// the user's preferences plus the surface's layout facts.
export const EmitterOptionsSchema = z
  .object({ ...commonEmitterOptionShape, ...surfaceLayoutOptionShape })
  .strict()
  .optional();

export const SvelteEmitterOptionsSchema = z
  .object({ ...commonEmitterOptionShape, ...surfaceLayoutOptionShape })
  .strict()
  .optional();

export const ReactEmitterOptionsSchema = z
  .object({
    ...commonEmitterOptionShape,
    ...surfaceLayoutOptionShape,
    typescript: z.boolean().optional(),
  })
  .strict()
  .optional();

export const EmitterConfigSchema = z
  .object({
    html: ConfigEmitterOptionsSchema,
    svelte: ConfigEmitterOptionsSchema,
    react: ConfigReactEmitterOptionsSchema,
    standalone: ConfigEmitterOptionsSchema,
  })
  .strict()
  .optional();

export type EmitterOptions = z.infer<typeof EmitterOptionsSchema>;
export type SvelteEmitterOptions = z.infer<typeof SvelteEmitterOptionsSchema>;
export type ReactEmitterOptions = z.infer<typeof ReactEmitterOptionsSchema>;

/** What a user may write. Parsed from config; carries no layout facts. */
export type EmitterConfig = z.infer<typeof EmitterConfigSchema>;

/**
 * What `emitAll` actually receives: the user's `EmitterConfig` after the surface
 * has stated its layout. Every `EmitterConfig` is a valid `ResolvedEmitterConfig`
 * (the extra fields are optional), so a caller with nothing to state may pass its
 * config straight through.
 */
export interface ResolvedEmitterConfig {
  html?: EmitterOptions;
  svelte?: SvelteEmitterOptions;
  react?: ReactEmitterOptions;
  standalone?: EmitterOptions;
}

/**
 * State the surface's asset layout for every format at once.
 *
 * One call per surface, at the point where the surface already knows what it
 * does with the files — that is the only place the answer exists. Formats the
 * caller did not configure still get the layout: `assetBase` is not optional
 * information the way `positionMode` is, and an emitter that fell back to a
 * guess is exactly the defect this replaced.
 */
export function withAssetBase(
  config: EmitterConfig | ResolvedEmitterConfig | undefined,
  assetBase: string,
): ResolvedEmitterConfig {
  return {
    html: { ...config?.html, assetBase },
    svelte: { ...config?.svelte, assetBase },
    react: { ...config?.react, assetBase },
    standalone: { ...config?.standalone, assetBase },
  };
}
