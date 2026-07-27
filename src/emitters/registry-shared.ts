import type { ArtboardGroup } from "../core/group-artboards.js";
import { type StructuredWarning, warningMessages } from "../core/warnings.js";
import type { EmitterReadyDocument } from "../ir/types.js";
import { emitHTML } from "./html.js";
import { emitReact } from "./react.js";
import { emitSvelte } from "./svelte.js";
import type { EmitterConfig, EmitterOptions } from "./types.js";

export interface EmitFile {
  slug: string;
  extension: string;
  output: string;
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
    emitterConfig?: EmitterConfig,
  ) => EmitResult;
}

export interface StandaloneEmitterResult {
  html: string;
  warnings: string[];
  structuredWarnings: StructuredWarning[];
}

export function createBuiltinEmitters(
  emitStandaloneLike: (
    doc: EmitterReadyDocument,
    options?: EmitterOptions,
  ) => StandaloneEmitterResult,
): Record<string, SharedEmitterDescriptor> {
  return {
    html: {
      name: "html",
      emitAll: (doc, groups, emitterConfig) =>
        perGroup(
          doc,
          groups,
          normalizeExtension(doc.settings.htmlOutputExtension || ".html"),
          (d, g) => {
            const result = emitHTML(
              d,
              { artboards: g.artboards, slug: g.slug },
              emitterConfig?.html,
            );
            return { output: result.html, warnings: result.structuredWarnings };
          },
        ),
    },
    svelte: {
      name: "svelte",
      emitAll: (doc, groups, emitterConfig) =>
        perGroup(doc, groups, ".svelte", (d, g) => {
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
        const extension = reactOptions?.typescript ? ".tsx" : ".jsx";
        return perGroup(doc, groups, extension, (d, g) => {
          const result = emitReact(d, { artboards: g.artboards, slug: g.slug }, reactOptions);
          return { output: result.jsx, warnings: result.structuredWarnings };
        });
      },
    },
    standalone: {
      name: "standalone",
      emitAll: (doc, _groups, emitterConfig) => {
        const result = emitStandaloneLike(doc, emitterConfig?.standalone);
        const slug = doc.settings.projectName || doc.metadata.slug;
        return {
          files: [{ slug, extension: ".html", output: result.html }],
          warnings: result.warnings,
          structuredWarnings: result.structuredWarnings,
        };
      },
    },
  };
}

function normalizeExtension(ext: string): string {
  return ext.startsWith(".") ? ext : `.${ext}`;
}

function perGroup(
  doc: EmitterReadyDocument,
  groups: ArtboardGroup[],
  extension: string,
  emit: (
    doc: EmitterReadyDocument,
    group: ArtboardGroup,
  ) => { output: string; warnings: StructuredWarning[] },
): EmitResult {
  const files: EmitFile[] = [];
  const warnings: StructuredWarning[] = [];
  for (const group of groups) {
    const result = emit(doc, group);
    files.push({ slug: group.slug, extension, output: result.output });
    for (const warning of result.warnings) warnings.push(warning);
  }
  return { files, warnings: warningMessages(warnings), structuredWarnings: warnings };
}
