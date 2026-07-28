import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import type { Document } from "../../src/ir/types.js";
import { ensureFreshArtifact } from "../helpers/extendscript-build.js";

const bundleRelativePath = "dist/extendscript/all2html-core.js";
const bundlePath = resolve(import.meta.dirname, "../..", bundleRelativePath);
const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");
const baselinePath = resolve(import.meta.dirname, "../fixtures/extendscript-bundle-baseline.json");

/** Rebuilds the bundle when it is missing or older than its inputs. */
function ensureBundleExists(): void {
  ensureFreshArtifact(bundleRelativePath, "build:extendscript");
}

interface SizeBaseline {
  artifact: string;
  build: string;
  bytes: number;
  recordedAt: string;
  growthTolerance: number;
  history: { bytes: number; reason: string }[];
}

interface SizeBaselines {
  note: string;
  artifacts: Record<"core" | "assembled" | "afterEffects", SizeBaseline>;
}

function loadBaselines(): SizeBaselines {
  return JSON.parse(readFileSync(baselinePath, "utf-8"));
}

function bytes(value: number): string {
  return `${value.toLocaleString("en-US")} B`;
}

function loadFixture(name: string): Document {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

function loadBundle(): {
  processAndEmit: (doc: Document, config?: unknown) => { html: string; warnings: string[] };
} {
  ensureBundleExists();
  const code = readFileSync(bundlePath, "utf-8");
  // Evaluate the IIFE — it assigns to `All2Html`
  const fn = new Function(`${code}\nreturn All2Html;`);
  return fn();
}

/**
 * Reports an artifact's size against its recorded baseline and fails past the
 * growth tolerance.
 *
 * The old guard was a fixed 100KB cliff. `removeComments: true` was added to
 * tsconfig.extendscript.json to squeeze back under it — a one-time trick that
 * cannot be repeated, after which the guard tracked nothing but the distance to
 * the next failing build. A baseline plus tolerance replaced it.
 *
 * That still let growth hide: the tolerance *permits* sub-budget drift, and only
 * re-records land in git history, so 3,752 B — 69% of the core allowance —
 * accumulated with nobody deciding to spend it. So any nonzero delta is now
 * reported as UNATTRIBUTED DRIFT with the share of tolerance it consumes, and a
 * re-record must carry a matching `history` entry to be accepted.
 */
function assertSizeBudget(label: string, baseline: SizeBaseline): void {
  const artifactPath = ensureFreshArtifact(baseline.artifact, baseline.build);
  const size = readFileSync(artifactPath).length;
  const budget = Math.round(baseline.bytes * (1 + baseline.growthTolerance));
  const delta = size - baseline.bytes;
  const allowance = budget - baseline.bytes;
  const headroom = budget - size;
  const percent = (value: number): string =>
    `${value >= 0 ? "+" : ""}${((value / baseline.bytes) * 100).toFixed(1)}%`;

  const lines = [
    `${label} (${baseline.artifact}): ${bytes(size)}`,
    `  baseline ${bytes(baseline.bytes)} (recorded ${baseline.recordedAt}) — ` +
      `${delta >= 0 ? "+" : "−"}${bytes(Math.abs(delta))} ${percent(delta)}`,
    `  budget   ${bytes(budget)} (${percent(allowance)}) — ${bytes(headroom)} headroom left`,
  ];
  if (delta > 0) {
    lines.push(
      `  UNATTRIBUTED DRIFT: ${bytes(delta)} above the recorded baseline, ` +
        `${((delta / allowance) * 100).toFixed(0)}% of the ${bytes(allowance)} tolerance. ` +
        'Attribute it in "history" and re-record "bytes", or reclaim it.',
    );
  }
  console.log(lines.join("\n"));

  if (size < baseline.bytes * (1 - baseline.growthTolerance)) {
    console.warn(
      `${label} is ${bytes(-delta)} smaller than the baseline. Re-record ` +
        `${baseline.bytes} → ${size} in test/fixtures/extendscript-bundle-baseline.json ` +
        "so the budget keeps tracking real size.",
    );
  }

  // A re-record without an attribution is the thing this guard exists to stop.
  const last = baseline.history.at(-1);
  expect(
    last?.bytes,
    `The last "history" entry for ${label} records ${last?.bytes ?? "nothing"} but "bytes" is ` +
      `${baseline.bytes}. Every re-record needs an entry naming what the bytes bought.`,
  ).toBe(baseline.bytes);

  expect(size).toBeGreaterThan(0);
  expect(
    size,
    `${label} is ${bytes(size)}, over the ${bytes(budget)} budget ` +
      `(baseline ${bytes(baseline.bytes)} ${percent(delta)}). If the growth is intended, ` +
      `update "bytes" to ${size}, "recordedAt", and add a "history" entry in ` +
      "test/fixtures/extendscript-bundle-baseline.json in the same commit.",
  ).toBeLessThanOrEqual(budget);
}

describe("ExtendScript bundle", () => {
  it("core bundle stays within its size budget", () => {
    assertSizeBudget("ExtendScript core bundle", loadBaselines().artifacts.core);
  });

  // dist/all2html.js is what users install: json2 + the core bundle +
  // exporter.jsx. Guarding only the intermediate core left roughly 45% of the
  // shipped file — including every byte of the exporter — with no budget.
  it("assembled Illustrator bundle stays within its size budget", () => {
    assertSizeBudget("Assembled Illustrator bundle", loadBaselines().artifacts.assembled);
  });

  // dist/after-effects/all2html-ae.jsx had no budget at all while it was a
  // standalone .jsx with hand-copied helpers. It now concatenates a real bundle
  // (D13), which is exactly when an artifact starts growing for reasons nobody
  // reviews.
  //
  // The 300 s budget: this is the first case in the file that can shell out to
  // `build:after-effects`, and it may also be queued behind another worker
  // holding the build lock (whose own deadline is 300 s).
  it("assembled After Effects script stays within its size budget", () => {
    assertSizeBudget("Assembled After Effects script", loadBaselines().artifacts.afterEffects);
  }, 300_000);

  // The panel `help` copy was moved out of SETTING_DEFINITIONS into
  // src/ir/setting-help.ts precisely because it cost 8,706 B here and only the
  // CEP panel and the docs generator read it. Nothing in the ExtendScript entry
  // graph may import that module again.
  it("does not ship panel help prose", () => {
    ensureBundleExists();
    const code = readFileSync(bundlePath, "utf-8");
    expect(code).not.toContain("docsAnchor");
    expect(code).not.toContain("Palette-based PNG");
  });

  it("exports processAndEmit function", () => {
    const bundle = loadBundle();
    expect(typeof bundle.processAndEmit).toBe("function");
  });

  // The reserved-word guard used to live here and scanned this one file with
  // five regexes. It moved to `extendscript-reserved-words.test.ts`, which parses
  // every ExtendScript-executed artifact and every ExtendScript-bound source with
  // the real ES3 reserved vocabulary — the version here could not see a function
  // name, a second declarator, an object key, or the hand-written exporters.

  it("does not emit Map or Set constructors into the ExtendScript bundle", () => {
    ensureBundleExists();
    const code = readFileSync(bundlePath, "utf-8");
    expect(code).not.toMatch(/new\s+(Map|Set)\s*\(/);
  });

  it("loads when Array.isArray is missing before bundle polyfills install", () => {
    ensureBundleExists();
    const code = readFileSync(bundlePath, "utf-8");
    const originalIsArray = Array.isArray;
    const originalIndexOf = Array.prototype.indexOf;
    const originalNumberIsNaN = Number.isNaN;
    try {
      (Array as unknown as { isArray?: unknown }).isArray = undefined;
      (Array.prototype as unknown as { indexOf?: unknown }).indexOf = undefined;
      (Number as unknown as { isNaN?: unknown }).isNaN = undefined;
      const fn = new Function(`${code}\nreturn All2Html;`);
      const bundle = fn();
      expect(typeof bundle.processAndEmit).toBe("function");
      expect(typeof Array.isArray).toBe("function");
      expect(typeof Array.prototype.indexOf).toBe("function");
      expect(typeof Number.isNaN).toBe("function");
    } finally {
      (Array as unknown as { isArray?: unknown }).isArray = originalIsArray;
      (Array.prototype as unknown as { indexOf?: unknown }).indexOf = originalIndexOf;
      (Number as unknown as { isNaN?: unknown }).isNaN = originalNumberIsNaN;
    }
  });

  // The bundle's processAndEmit models the Illustrator surface, which writes the
  // HTML and its images into one directory and so emits a bare `src`. The Node
  // reference needs no special configuration to match: `assetBase` defaults to
  // "" — an emitted file and its assets are siblings unless a surface says
  // otherwise — and `imageOutputPath` no longer reaches the markup on any path.
  // This used to pass `settings: { imageOutputPath: "" }`, mirroring a mutation
  // `processAndEmit` performed on the resolved settings.

  it("produces identical output to Node.js pipeline for single artboard", () => {
    const bundle = loadBundle();
    const raw = loadFixture("single-artboard-basic.json");

    // Node.js pipeline
    const { document: nodeDoc } = processDocument(raw);
    const { html: nodeHtml } = emitHTML(nodeDoc);

    // Bundle pipeline
    const { html: bundleHtml } = bundle.processAndEmit(raw);

    expect(bundleHtml).toBe(nodeHtml);
  });

  it("produces identical output for multi-artboard responsive", () => {
    const bundle = loadBundle();
    const raw = loadFixture("multi-artboard-responsive.json");

    const { document: nodeDoc } = processDocument(raw);
    const { html: nodeHtml } = emitHTML(nodeDoc);

    const { html: bundleHtml } = bundle.processAndEmit(raw);

    expect(bundleHtml).toBe(nodeHtml);
  });

  it("warns about unknown fonts", () => {
    const bundle = loadBundle();
    const raw = loadFixture("single-artboard-basic.json");
    const element = raw.artboards[0]?.layers[0]?.elements[0];
    if (element?.type !== "text") {
      throw new Error("Fixture must start with a text element");
    }
    const run = element.paragraphs[0]?.runs[0];
    if (!run) {
      throw new Error("Fixture text element must include a font run");
    }
    run.fontName = "UnknownFont-Bold";

    const { warnings } = bundle.processAndEmit(raw);

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("UnknownFont-Bold");
  });
});
