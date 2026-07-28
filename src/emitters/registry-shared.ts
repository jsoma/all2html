import type { ArtboardGroup } from "../core/group-artboards.js";
import { resolveOutputExtension } from "../core/output-extension.js";
import { type StructuredWarning, warningMessages } from "../core/warnings.js";
import type { EmitterReadyDocument } from "../ir/types.js";
import { emitHTML } from "./html.js";
import type { EmitGroupOptions } from "./html-tree.js";
import { emitReact } from "./react.js";
import { emitSvelte } from "./svelte.js";
import type { EmitterOptions, ResolvedEmitterConfig } from "./types.js";

export interface EmitFile {
  slug: string;
  extension: string;
  output: string;
  /**
   * Declared by the emitter that produced the file — the one thing that knows
   * what it wrote. `createOutputBundle` copies this into the manifest; it used
   * to *infer* MIME from the extension, which called a custom
   * `htmlOutputExtension` (`.php`) not-HTML.
   */
  mimeType: string;
}

export interface EmitResult {
  files: EmitFile[];
  /** Plain-string projection of `structuredWarnings`. */
  warnings: string[];
  structuredWarnings: StructuredWarning[];
}

export interface SharedEmitterDescriptor {
  name: string;
  emitAll: (
    doc: EmitterReadyDocument,
    groups: ArtboardGroup[],
    emitterConfig?: ResolvedEmitterConfig,
  ) => EmitResult;
}

export interface StandaloneEmitterResult {
  html: string;
  warnings: string[];
  structuredWarnings: StructuredWarning[];
}

export function createBuiltinEmitters(
  /**
   * The group-aware standalone entry point (`emitStandaloneGroup` /
   * `emitStandaloneBrowserGroup`), never the public `emitStandalone`, whose
   * second parameter is `EmitterOptions`.
   */
  emitStandaloneLike: (
    doc: EmitterReadyDocument,
    groupOptions?: EmitGroupOptions,
    options?: EmitterOptions,
  ) => StandaloneEmitterResult,
): Record<string, SharedEmitterDescriptor> {
  return {
    html: {
      name: "html",
      emitAll: (doc, groups, emitterConfig) => {
        // The only emitter that reads the setting, and the setting is a filename
        // component: an unsafe value is rejected here (with a warning) rather
        // than carried to whichever sink writes the file.
        const settingWarnings: StructuredWarning[] = [];
        const extension = resolveOutputExtension(doc.settings.htmlOutputExtension, settingWarnings);
        return perGroup(
          doc,
          groups,
          extension,
          // The content is an HTML fragment whatever `htmlOutputExtension`
          // renamed the file to — the setting changes the name, not the grammar.
          "text/html",
          (d, g) => {
            const result = emitHTML(
              d,
              { artboards: g.artboards, slug: g.slug },
              emitterConfig?.html,
            );
            return { output: result.html, warnings: result.structuredWarnings };
          },
          settingWarnings,
        );
      },
    },
    svelte: {
      name: "svelte",
      emitAll: (doc, groups, emitterConfig) =>
        perGroup(doc, groups, SVELTE_EXTENSION, SOURCE_MIME_TYPE, (d, g) => {
          const result = emitSvelte(
            d,
            { artboards: g.artboards, slug: g.slug },
            emitterConfig?.svelte,
          );
          return { output: result.svelte, warnings: result.structuredWarnings };
        }),
    },
    react: {
      name: "react",
      emitAll: (doc, groups, emitterConfig) => {
        const reactOptions = emitterConfig?.react;
        return perGroup(
          doc,
          groups,
          reactOutputExtension(emitterConfig),
          SOURCE_MIME_TYPE,
          (d, g) => {
            const result = emitReact(d, { artboards: g.artboards, slug: g.slug }, reactOptions);
            return { output: result.jsx, warnings: result.structuredWarnings };
          },
        );
      },
    },
    // Standalone is group-aware like the other three. The extension stays
    // `.html` regardless of `htmlOutputExtension` — a full document with a
    // `.svelte` name would be a lie — which is what `HTML_ONLY_OUTPUT_EXTENSION`
    // in `src/core/capabilities.ts` declares.
    standalone: {
      name: "standalone",
      emitAll: (doc, groups, emitterConfig) =>
        perGroup(doc, groups, STANDALONE_EXTENSION, "text/html", (d, g) => {
          const result = emitStandaloneLike(
            d,
            { artboards: g.artboards, slug: g.slug },
            emitterConfig?.standalone,
          );
          return { output: result.html, warnings: result.structuredWarnings };
        }),
    },
  };
}

const SVELTE_EXTENSION = ".svelte";
const STANDALONE_EXTENSION = ".html";
/**
 * Svelte and React emit component *source*, which no registered MIME type
 * names; `text/plain` is the honest declaration (and what the manifest carried
 * back when the bundle inferred it from the extension).
 */
const SOURCE_MIME_TYPE = "text/plain";

/** The single statement of the react rule; `formatDictatedExtension` reuses it. */
function reactOutputExtension(emitterConfig?: ResolvedEmitterConfig): string {
  return emitterConfig?.react?.typescript ? ".tsx" : ".jsx";
}

/**
 * The extension `format` writes **regardless of `htmlOutputExtension`**, or
 * `undefined` for `html`, which writes the (sanitized) setting itself.
 *
 * This exists so the capability checker can compare a requested extension
 * against the one file name the run will actually produce. It used to be stated
 * twice — once by the react arm above and once as the list `[".jsx", ".tsx"]` in
 * `src/core/capabilities.ts` — and the list version accepted `.tsx` silently on
 * a run that emitted `.jsx`. Callers that select a format pass the result as
 * `SurfaceContext.formatExtension`.
 */
export function formatDictatedExtension(
  format: string,
  emitterConfig?: ResolvedEmitterConfig,
): string | undefined {
  if (format === "svelte") return SVELTE_EXTENSION;
  if (format === "react") return reactOutputExtension(emitterConfig);
  if (format === "standalone") return STANDALONE_EXTENSION;
  return undefined;
}

function perGroup(
  doc: EmitterReadyDocument,
  groups: ArtboardGroup[],
  extension: string,
  mimeType: string,
  emit: (
    doc: EmitterReadyDocument,
    group: ArtboardGroup,
  ) => { output: string; warnings: StructuredWarning[] },
  /** Warnings raised once for the whole emit, before any group is rendered. */
  seedWarnings?: StructuredWarning[],
): EmitResult {
  const files: EmitFile[] = [];
  const warnings: StructuredWarning[] = seedWarnings ? seedWarnings.slice() : [];
  for (const group of groups) {
    const result = emit(doc, group);
    files.push({ slug: group.slug, extension, output: result.output, mimeType });
    for (const warning of result.warnings) warnings.push(warning);
  }
  return { files, warnings: warningMessages(warnings), structuredWarnings: warnings };
}
