import type { EmitterReadyDocument, ResolvedDocument } from "../ir/types.js";
import { loadAndValidateIR } from "../ir/validate.js";
import { checkCapabilitiesForSurface, type SurfaceContext } from "./capabilities.js";
import { computeBreakpoints } from "./compute-breakpoints.js";
import { computePositions } from "./compute-positions.js";
import { computeStyles } from "./compute-styles.js";
import { deduplicateStyles } from "./deduplicate-styles.js";
import { type ArtboardGroup, groupArtboards } from "./group-artboards.js";
import { assertJsonPure } from "./json-purity.js";
import { noopLogger, type ObservableLogger } from "./logger.js";
import { type StructuredWarning, warningMessages } from "./warnings.js";

export interface SharedPipelineResult {
  document: EmitterReadyDocument;
  groups: ArtboardGroup[];
  /** Plain-string projection of `structuredWarnings`. */
  warnings: string[];
  structuredWarnings: StructuredWarning[];
}

export interface SharedPipelineOptions {
  logger?: ObservableLogger;
  resolveSettings(raw: ReturnType<typeof loadAndValidateIR>): ResolvedDocument;
  resolveSettingsSpanData?: Record<string, unknown>;
  /**
   * Which surface is driving this run. Its capability declaration decides which
   * resolved settings are honored; anything unhonored warns (SPEC 12.5).
   */
  surface: SurfaceContext;
}

export function processDocumentShared(
  irJson: unknown,
  options: SharedPipelineOptions,
): SharedPipelineResult {
  const log = options.logger ?? noopLogger;
  const warnings: StructuredWarning[] = [];

  let span = log.startSpan("loadAndValidateIR");
  const raw = loadAndValidateIR(irJson);
  span.set("artboards", raw.artboards.length);
  span.end();

  span = log.startSpan("resolveSettings", options.resolveSettingsSpanData);
  const resolved = options.resolveSettings(raw);
  assertJsonPure(resolved, "resolveSettings");
  span.end();

  span = log.startSpan("checkCapabilities", { surface: options.surface.surface });
  const capabilityWarnings = checkCapabilitiesForSurface(resolved.settings, options.surface);
  warnings.push(...capabilityWarnings);
  span.set("warnings", capabilityWarnings.length);
  span.end();

  for (const warning of capabilityWarnings) {
    log.warn(warning.message, { type: warning.code, setting: warning.setting });
  }

  span = log.startSpan("computeBreakpoints", { artboards: resolved.artboards.length });
  const withBreakpoints = computeBreakpoints(resolved);
  assertJsonPure(withBreakpoints, "computeBreakpoints");
  span.end();

  span = log.startSpan("computeStyles");
  const { document: styled, warnings: styleWarnings } = computeStyles(withBreakpoints);
  assertJsonPure(styled, "computeStyles");
  warnings.push(...styleWarnings);
  span.set("warnings", styleWarnings.length);
  span.end();

  for (const warning of styleWarnings) {
    log.warn(warning.message, { type: warning.code });
  }

  span = log.startSpan("deduplicateStyles");
  const deduped = deduplicateStyles(styled);
  assertJsonPure(deduped, "deduplicateStyles");
  span.end();

  span = log.startSpan("computePositions");
  const ready = computePositions(deduped);
  assertJsonPure(ready, "computePositions");
  span.end();

  span = log.startSpan("groupArtboards", { output: ready.settings.output });
  const groups = groupArtboards(ready);
  // No assertJsonPure here on purpose. `groupArtboards` only partitions the existing
  // artboard references into arrays — it introduces no new numbers — so a sixth walk
  // over the same objects has zero coverage value and cost roughly a third of the
  // total guard budget. The `computePositions` assertion above already covered them.
  span.set("groups", groups.length);
  span.end();

  log.info("pipeline complete", {
    artboards: ready.artboards.length,
    groups: groups.length,
    warnings: warnings.length,
  });

  return {
    document: ready,
    groups,
    warnings: warningMessages(warnings),
    structuredWarnings: warnings,
  };
}
