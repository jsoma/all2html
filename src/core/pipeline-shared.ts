import type { EmitterReadyDocument, ResolvedDocument } from "../ir/types.js";
import { loadAndValidateIR } from "../ir/validate.js";
import { computeBreakpoints } from "./compute-breakpoints.js";
import { computePositions } from "./compute-positions.js";
import { computeStyles } from "./compute-styles.js";
import { deduplicateStyles } from "./deduplicate-styles.js";
import { type ArtboardGroup, groupArtboards } from "./group-artboards.js";
import { noopLogger, type ObservableLogger } from "./logger.js";

export interface SharedPipelineResult {
  document: EmitterReadyDocument;
  groups: ArtboardGroup[];
  warnings: string[];
}

export interface SharedPipelineOptions {
  logger?: ObservableLogger;
  resolveSettings(raw: ReturnType<typeof loadAndValidateIR>): ResolvedDocument;
  resolveSettingsSpanData?: Record<string, unknown>;
}

export function processDocumentShared(
  irJson: unknown,
  options: SharedPipelineOptions,
): SharedPipelineResult {
  const log = options.logger ?? noopLogger;
  const warnings: string[] = [];

  let span = log.startSpan("loadAndValidateIR");
  const raw = loadAndValidateIR(irJson);
  span.set("artboards", raw.artboards.length);
  span.end();

  span = log.startSpan("resolveSettings", options.resolveSettingsSpanData);
  const resolved = options.resolveSettings(raw);
  span.end();

  span = log.startSpan("computeBreakpoints", { artboards: resolved.artboards.length });
  const withBreakpoints = computeBreakpoints(resolved);
  span.end();

  span = log.startSpan("computeStyles");
  const { document: styled, warnings: styleWarnings } = computeStyles(withBreakpoints);
  warnings.push(...styleWarnings);
  span.set("warnings", styleWarnings.length);
  span.end();

  for (const warning of styleWarnings) {
    log.warn(warning, { type: "font:missing" });
  }

  span = log.startSpan("deduplicateStyles");
  const deduped = deduplicateStyles(styled);
  span.end();

  span = log.startSpan("computePositions");
  const ready = computePositions(deduped);
  span.end();

  span = log.startSpan("groupArtboards", { output: ready.settings.output });
  const groups = groupArtboards(ready);
  span.set("groups", groups.length);
  span.end();

  log.info("pipeline complete", {
    artboards: ready.artboards.length,
    groups: groups.length,
    warnings: warnings.length,
  });

  return { document: ready, groups, warnings };
}
