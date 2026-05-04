import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTMLString } from "../../src/emitters/html-string.js";
import type { Document } from "../../src/ir/types.js";

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

  it("does not emit ExtendScript reserved local variable names", () => {
    ensureBundleExists();
    const code = readFileSync(bundlePath, "utf-8");
    expect(code).not.toMatch(/\bvar\s+char\b/);
  });

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
