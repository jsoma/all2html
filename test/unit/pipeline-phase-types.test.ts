/**
 * The phase contract (SPEC §12.1, decision D20).
 *
 * The core of this file is `phaseMisuseIsATypeError` below: a function that is never
 * called, whose body is a list of `@ts-expect-error` assertions. Each one fails the
 * build (`pnpm run typecheck` includes `test/**`) if the misuse it describes ever
 * becomes type-correct again. Before this contract landed, every one of them compiled
 * cleanly — which is precisely what made the phase types decorative.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { computeBreakpoints } from "../../src/core/compute-breakpoints.js";
import { computePositions } from "../../src/core/compute-positions.js";
import { computeStyles } from "../../src/core/compute-styles.js";
import { deduplicateStyles } from "../../src/core/deduplicate-styles.js";
import { resolveSettings } from "../../src/core/resolve-settings.js";
import type {
  BreakpointedDocument,
  DeduplicatedDocument,
  Document,
  EmitterReadyDocument,
  ResolvedDocument,
  StyledDocument,
} from "../../src/ir/types.js";
import { loadAndValidateIR } from "../../src/ir/validate.js";

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Compile-time only. Never invoked — `tsc` is the assertion runner here, and calling
 * it would run transforms against documents they are typed to reject.
 */
function phaseMisuseIsATypeError(
  resolved: ResolvedDocument,
  breakpointed: BreakpointedDocument,
  styled: StyledDocument,
  deduplicated: DeduplicatedDocument,
  emitterReady: EmitterReadyDocument,
): void {
  // --- a transform cannot be skipped ---
  // @ts-expect-error skipping computeBreakpoints: computeStyles consumes `breakpointed`
  computeStyles(resolved);
  // @ts-expect-error skipping computeStyles: deduplicateStyles consumes `styled`
  deduplicateStyles(breakpointed);
  // @ts-expect-error skipping deduplicateStyles: computePositions consumes `deduplicated`
  computePositions(styled);
  // @ts-expect-error skipping computePositions: the emitters consume `emitterReady`
  const skipped: EmitterReadyDocument = deduplicated;
  void skipped;

  // --- a transform cannot be run twice ---
  // @ts-expect-error computeBreakpoints consumes `resolved` and produces `breakpointed`
  computeBreakpoints(breakpointed);
  // @ts-expect-error computeStyles consumes `breakpointed` and produces `styled`
  computeStyles(styled);
  // @ts-expect-error deduplicateStyles consumes `styled` and produces `deduplicated`
  deduplicateStyles(deduplicated);
  // @ts-expect-error computePositions consumes `deduplicated` and produces `emitterReady`
  computePositions(emitterReady);

  // --- a phase document is not a source document ---
  // @ts-expect-error resolveSettings consumes the validated source IR, not a phase doc
  resolveSettings(emitterReady);
  // @ts-expect-error ...and phase documents stay internal: they are not persistable IR
  const persisted: Document = emitterReady;
  void persisted;

  // --- breakpoints do not exist before computeBreakpoints ---
  // @ts-expect-error `breakpoint` is absent from a resolved artboard, not a placeholder
  void resolved.artboards[0].breakpoint;

  // --- image-rendered text is never styled ---
  for (const el of styled.artboards[0].layers[0].elements) {
    if (el.type !== "text") continue;
    if (el.renderAs === "image") {
      // @ts-expect-error image-rendered text is its own variant and carries no styles
      void el.computedParagraphStyles;
    } else {
      void el.computedParagraphStyles;
    }
  }

  // --- emitter-ready layers admit no un-processed variants ---
  for (const el of emitterReady.artboards[0].layers[0].elements) {
    if (el.type === "shape") void el.computedShapePosition;
    if (el.type === "snippet") void el.computedPosition;
  }
}

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function load(name: string): Document {
  return loadAndValidateIR(JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8")));
}

function runPhases(source: Document) {
  const resolved = resolveSettings(source);
  const breakpointed = computeBreakpoints(resolved);
  const styled = computeStyles(breakpointed).document;
  const deduplicated = deduplicateStyles(styled);
  const emitterReady = computePositions(deduplicated);
  return { resolved, breakpointed, styled, deduplicated, emitterReady };
}

describe("pipeline phases are exclusive, not additive", () => {
  it("carries its type-level assertions in a function tsc checks and vitest never calls", () => {
    // Referenced, deliberately not called: the value of the block above is that
    // `pnpm run typecheck` fails if any of its `@ts-expect-error` lines stops erroring.
    expect(typeof phaseMisuseIsATypeError).toBe("function");
  });

  it("tags every intermediate document with its phase", () => {
    const p = runPhases(load("multi-artboard-responsive.json"));
    expect(p.resolved.pipelinePhase).toBe("resolved");
    expect(p.breakpointed.pipelinePhase).toBe("breakpointed");
    expect(p.styled.pipelinePhase).toBe("styled");
    expect(p.deduplicated.pipelinePhase).toBe("deduplicated");
    expect(p.emitterReady.pipelinePhase).toBe("emitterReady");
  });

  it("has no breakpoint at all before computeBreakpoints runs", () => {
    const { resolved, breakpointed } = runPhases(load("multi-artboard-responsive.json"));

    for (const ab of resolved.artboards) {
      // The placeholder `{ minWidth: 0, widthRangeMin: 0 }` that existed purely to
      // satisfy the old `ResolvedArtboard` is gone — the key is not present at all.
      expect("breakpoint" in ab).toBe(false);
    }
    for (const ab of breakpointed.artboards) {
      expect(typeof ab.breakpoint.minWidth).toBe("number");
    }
  });

  it("inserts no computedPosition placeholder before computePositions runs", () => {
    const { deduplicated, emitterReady } = runPhases(load("single-artboard-basic.json"));

    for (const ab of deduplicated.artboards) {
      for (const layer of ab.layers) {
        for (const el of layer.elements) {
          expect("computedPosition" in el).toBe(false);
        }
      }
    }

    let positioned = 0;
    for (const ab of emitterReady.artboards) {
      for (const layer of ab.layers) {
        for (const el of layer.elements) {
          if (el.type === "text" && el.renderAs === "html") {
            expect(el.computedPosition.width).not.toBe("");
            positioned++;
          }
        }
      }
    }
    expect(positioned).toBeGreaterThan(0);
  });

  it("leaves image-rendered text untouched through every transform", () => {
    // No tracked fixture rasterizes text, so this document is derived inline.
    const raw = JSON.parse(
      readFileSync(resolve(fixturesDir, "single-artboard-basic.json"), "utf-8"),
    );
    for (const layer of raw.artboards[0].layers) {
      for (const el of layer.elements) {
        if (el.type === "text") el.renderAs = "image";
      }
    }

    const { styled, emitterReady } = runPhases(loadAndValidateIR(raw));

    let imageText = 0;
    for (const ab of styled.artboards) {
      for (const layer of ab.layers) {
        for (const el of layer.elements) {
          if (el.type !== "text") continue;
          expect(el.renderAs).toBe("image");
          expect("computedParagraphStyles" in el).toBe(false);
          imageText++;
        }
      }
    }
    expect(imageText).toBeGreaterThan(0);

    for (const ab of emitterReady.artboards) {
      for (const layer of ab.layers) {
        for (const el of layer.elements) {
          if (el.type !== "text") continue;
          expect("computedPosition" in el).toBe(false);
        }
      }
    }
  });
});

describe("Artboard.relationship is gone (D27)", () => {
  const base = () =>
    JSON.parse(readFileSync(resolve(fixturesDir, "single-artboard-basic.json"), "utf-8"));

  /**
   * The field was accepted by the schema and read by nothing. D16 allows dead code
   * only with a test pinning its intended caller or a deletion naming its
   * replacement — a round-trip test is neither, so the field was removed rather
   * than documented. Its replacement is `groupArtboards`, which is where the
   * alternates/sequence distinction has to act and which cannot take it until it
   * is ES3-safe (D19). This test fails if the field is re-added without one.
   *
   * Since the schema went `.strict()`, an unrecognized field is *rejected* with
   * its path, not silently stripped — stripping is what let this field ship
   * dead in the first place.
   */
  it("is rejected by the strict schema, not stripped", () => {
    const raw = base();
    raw.artboards[0].relationship = "sequence";
    expect(() => loadAndValidateIR(raw)).toThrow(/artboards\.0.*relationship/s);
  });

  it("has no reader anywhere in src/", () => {
    const hits = listSourceFiles(resolve(import.meta.dirname, "../../src"))
      .filter((file) => /\brelationship\b/.test(readFileSync(file, "utf-8")))
      // types.ts keeps the tombstone comment naming the replacement (D16).
      .filter((file) => !file.endsWith(`${sep}ir${sep}types.ts`));
    expect(hits).toEqual([]);
  });
});
