import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTMLString } from "../../src/emitters/html-string.js";

const bundlePath = resolve(import.meta.dirname, "../../dist/extendscript/all2html-core.js");
const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function ensureBundleExists(): void {
  if (existsSync(bundlePath)) {
    return;
  }

  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  execFileSync(command, ["build:extendscript"], {
    cwd: resolve(import.meta.dirname, "../.."),
    stdio: "inherit",
  });
}

function loadFixture(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

function loadBundle(): {
  processAndEmit: (doc: any, config?: any) => { html: string; warnings: string[] };
} {
  ensureBundleExists();
  const code = readFileSync(bundlePath, "utf-8");
  // Evaluate the IIFE — it assigns to `All2Html`
  const fn = new Function(code + "\nreturn All2Html;");
  return fn();
}

describe("ExtendScript bundle", () => {
  it("bundle file exists and is under 100KB", () => {
    ensureBundleExists();
    const stat = readFileSync(bundlePath);
    expect(stat.length).toBeLessThan(100 * 1024);
    expect(stat.length).toBeGreaterThan(0);
  });

  it("exports processAndEmit function", () => {
    const bundle = loadBundle();
    expect(typeof bundle.processAndEmit).toBe("function");
  });

  it("produces identical output to Node.js pipeline for single artboard", () => {
    const bundle = loadBundle();
    const raw = loadFixture("single-artboard-basic.json");

    // Node.js pipeline
    const { document: nodeDoc } = processDocument(raw);
    const { html: nodeHtml } = emitHTMLString(nodeDoc);

    // Bundle pipeline
    const { html: bundleHtml } = bundle.processAndEmit(raw);

    expect(bundleHtml).toBe(nodeHtml);
  });

  it("produces identical output for multi-artboard responsive", () => {
    const bundle = loadBundle();
    const raw = loadFixture("multi-artboard-responsive.json");

    const { document: nodeDoc } = processDocument(raw);
    const { html: nodeHtml } = emitHTMLString(nodeDoc);

    const { html: bundleHtml } = bundle.processAndEmit(raw);

    expect(bundleHtml).toBe(nodeHtml);
  });

  it("warns about unknown fonts", () => {
    const bundle = loadBundle();
    const raw = loadFixture("single-artboard-basic.json");
    raw.artboards[0].layers[0].elements[0].paragraphs[0].runs[0].fontName = "UnknownFont-Bold";

    const { warnings } = bundle.processAndEmit(raw);

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("UnknownFont-Bold");
  });
});
