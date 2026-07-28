import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strToU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { hasOwn, opaqueKey } from "../../src/core/identifiers.js";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import {
  buildScopedAssetIndex,
  getScopedArtboardAsset,
  getScopedLayerAsset,
} from "../../src/emitters/shared/assets.js";
import type { Asset } from "../../src/ir/types.js";
import { bundleToZipBytes, type OutputBundle } from "../../src/output-bundle.js";

/**
 * The opaque-key convention (spec §2.2): every record keyed by an external id
 * keys by `opaqueKey(id)` and reads with own-property checks, so an id named
 * `__proto__`, `constructor` or `toString` is ordinary data — and the layer
 * asset scope is a nested record, so ids embedding `:` (both shipped ID
 * schemes do) cannot collide across the artboard/layer boundary.
 */

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function load(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

function makeAsset(id: string, artboardId: string, layerId?: string): Asset {
  const asset: Asset = {
    id,
    path: `${id.replace(/[^a-z0-9]+/gi, "-")}.png`,
    mimeType: "image/png",
    width: 10,
    height: 10,
    artboardId,
    exportParams: { format: "png", scale: 1 },
  };
  if (layerId !== undefined) asset.layerId = layerId;
  return asset;
}

/** Object.values is all the index reads, so plain keys here are fine. */
function assetRecord(assets: Asset[]): Record<string, Asset> {
  const record: Record<string, Asset> = Object.create(null);
  for (const asset of assets) record[asset.id] = asset;
  return record;
}

describe("opaqueKey / hasOwn", () => {
  it("prefixes with $ and answers own-ness only", () => {
    expect(opaqueKey("__proto__")).toBe("$__proto__");
    const record: Record<string, number> = {};
    record[opaqueKey("toString")] = 1;
    expect(hasOwn(record, opaqueKey("toString"))).toBe(true);
    expect(hasOwn(record, "toString")).toBe(false);
    expect(hasOwn({}, "toString")).toBe(false);
  });
});

describe("buildScopedAssetIndex with hostile ids", () => {
  const HOSTILE_IDS = ["__proto__", "constructor", "toString", "アートボード-1"];

  it("indexes and retrieves artboard assets under every hostile id", () => {
    for (const id of HOSTILE_IDS) {
      const asset = makeAsset(`bg:${id}`, id);
      const idx = buildScopedAssetIndex([{ id }], assetRecord([asset]));
      expect(getScopedArtboardAsset(idx, { id })).toBe(asset);
    }
  });

  it("indexes and retrieves layer assets under hostile layer ids", () => {
    for (const id of HOSTILE_IDS) {
      const asset = makeAsset(`layer:${id}`, "ab", id);
      const idx = buildScopedAssetIndex([{ id: "ab" }], assetRecord([asset]));
      expect(getScopedLayerAsset(idx, { id: "ab" }, id)).toBe(asset);
    }
  });

  it("misses cleanly (no prototype hits) for absent hostile ids", () => {
    const idx = buildScopedAssetIndex([{ id: "ab" }], assetRecord([]));
    expect(getScopedArtboardAsset(idx, { id: "constructor" })).toBeUndefined();
    expect(getScopedLayerAsset(idx, { id: "ab" }, "toString")).toBeUndefined();
    expect(getScopedLayerAsset(idx, { id: "__proto__" }, "x")).toBeUndefined();
  });

  it("keeps ('a:b','c') and ('a','b:c') apart — colon-embedding ids do not collide", () => {
    const first = makeAsset("asset-1", "a:b", "c");
    const second = makeAsset("asset-2", "a", "b:c");
    const idx = buildScopedAssetIndex([{ id: "a:b" }, { id: "a" }], assetRecord([first, second]));
    expect(getScopedLayerAsset(idx, { id: "a:b" }, "c")).toBe(first);
    expect(getScopedLayerAsset(idx, { id: "a" }, "b:c")).toBe(second);
    expect(getScopedLayerAsset(idx, { id: "a:b" }, "b:c")).toBeUndefined();
  });
});

describe("scopeArtboards with hostile artboard ids", () => {
  it("keeps an artboard whose id is __proto__ in its group", () => {
    const raw = load("single-artboard-basic.json");
    raw.artboards[0].id = "__proto__";
    for (const layer of raw.artboards[0].layers) {
      layer.id = `__proto__:layer:${layer.name}`;
    }
    // Keep asset references pointing at the renamed artboard, so the
    // background-image lookup exercises the opaque index under `__proto__` too.
    for (const asset of Object.values(raw.assets) as { artboardId: string }[]) {
      asset.artboardId = "__proto__";
    }

    const { document: doc } = processDocument(raw);
    // Group scoping used to key a plain object by the raw id, silently
    // dropping a `__proto__` artboard from every group.
    const { html } = emitHTML(doc, { artboards: doc.artboards });
    expect(html).toContain("Artboard:");
    expect(html).toContain('class="g-artboard"');
  });
});

describe("bundleToZipBytes with hostile entry names", () => {
  function bundleOf(paths: string[]): OutputBundle {
    return {
      files: paths.map((path) => ({
        path,
        bytes: strToU8(`content of ${path}`),
        mimeType: "application/octet-stream",
      })),
      manifest: { files: [] },
    } as unknown as OutputBundle;
  }

  it("keeps entries named constructor / toString / a __proto__ segment / Unicode", () => {
    const paths = ["constructor", "toString", "assets/__proto__.png", "アーカイブ.txt"];
    const zipBytes = bundleToZipBytes(bundleOf(paths));
    const names = Object.getOwnPropertyNames(unzipSync(zipBytes));
    for (const path of paths) {
      expect(names).toContain(path);
    }
  });

  it("rejects a top-level entry named exactly __proto__ with a real error", () => {
    // fflate's zipSync flattens into a plain object internally, so this one
    // name cannot be represented in the archive. It used to be *silently*
    // absent (the write rewired our own entry map's prototype); now the map is
    // null-prototype and the unrepresentable name is an explicit error.
    expect(() => bundleToZipBytes(bundleOf(["__proto__", "index.html"]))).toThrow(/__proto__/);
  });
});
