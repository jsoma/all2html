import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { emitReact } from "../../src/emitters/react.js";
import { assetBaseJoinRuntimeExpression, joinAssetBase } from "../../src/emitters/shared/assets.js";
import { emitSvelte } from "../../src/emitters/svelte.js";

/**
 * One asset-URL join rule (spec §2.8): exactly one `/` between a non-empty base
 * and the asset path. A base without a trailing slash used to concatenate
 * verbatim (`img` + `chart.png` → `imgchart.png`, a silent 404), while the
 * Svelte/React generated components applied the opposite policy at runtime.
 */

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function load(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

describe("joinAssetBase", () => {
  it("puts exactly one slash between base and path", () => {
    expect(joinAssetBase("img", "chart.png")).toBe("img/chart.png");
    expect(joinAssetBase("img/", "chart.png")).toBe("img/chart.png");
    expect(joinAssetBase("img//", "chart.png")).toBe("img/chart.png");
    expect(joinAssetBase("https://cdn.example.com/g", "chart.png")).toBe(
      "https://cdn.example.com/g/chart.png",
    );
    expect(joinAssetBase("https://cdn.example.com/g/", "chart.png")).toBe(
      "https://cdn.example.com/g/chart.png",
    );
  });

  it("keeps a site-root base of bare slashes as one slash", () => {
    expect(joinAssetBase("/", "chart.png")).toBe("/chart.png");
  });

  it("returns the path untouched for an empty base", () => {
    expect(joinAssetBase("", "chart.png")).toBe("chart.png");
  });
});

describe("emitted <img src> uses the join rule", () => {
  it("joins an imageSourcePath missing its trailing slash", () => {
    const raw = load("png-layer-overlay.json");
    raw.settings = { ...raw.settings, imageSourcePath: "img" };
    const { html } = emitHTML(processDocument(raw).document);
    expect(html).toContain('src="img/desktop-highlight.png"');
    expect(html).not.toContain("imgdesktop-highlight.png");
  });

  it("emits identical src for base with and without the slash", () => {
    const bare = load("png-layer-overlay.json");
    bare.settings = { ...bare.settings, imageSourcePath: "img" };
    const slashed = load("png-layer-overlay.json");
    slashed.settings = { ...slashed.settings, imageSourcePath: "img/" };
    expect(emitHTML(processDocument(bare).document).html).toBe(
      emitHTML(processDocument(slashed).document).html,
    );
  });

  it("warns with asset:base-query when the base carries a query or fragment", () => {
    for (const base of ["https://cdn.example.com/g?x=1", "img#frag"]) {
      const raw = load("png-layer-overlay.json");
      raw.settings = { ...raw.settings, imageSourcePath: base };
      const { structuredWarnings } = emitHTML(processDocument(raw).document);
      const warning = structuredWarnings.find((w) => w.code === "asset:base-query");
      expect(warning, base).toBeDefined();
      expect(warning?.category).toBe("image");
      expect(warning?.message).toContain(base);
    }
  });

  it("does not warn for a clean base", () => {
    const raw = load("png-layer-overlay.json");
    raw.settings = { ...raw.settings, imageSourcePath: "img/" };
    const { structuredWarnings } = emitHTML(processDocument(raw).document);
    expect(structuredWarnings.filter((w) => w.code === "asset:base-query")).toEqual([]);
  });
});

describe("framework emitters inline the shared runtime half of the rule", () => {
  it("react and svelte components normalize assetsPath with the shared expression", () => {
    const raw = load("png-layer-overlay.json");
    const { document: doc } = processDocument(raw);
    const expression = assetBaseJoinRuntimeExpression("assetsPath");
    expect(emitReact(doc).jsx).toContain(expression);
    expect(emitSvelte(doc).svelte).toContain(expression);
  });
});
