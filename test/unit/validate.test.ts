import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Asset, HtmlTextElement, Layer } from "../../src/ir/types.js";
import { IRValidationError, loadAndValidateIR } from "../../src/ir/validate.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

/**
 * Compile-time only — `pnpm run typecheck` includes `test/**`, so tsc is the
 * assertion runner here and vitest never calls this. Focused on the two shapes
 * §4.1 changed: the transform matrix became a six-number tuple, and
 * `Layer.inlineSvg` became optional.
 */
function changedShapesAreExact(el: HtmlTextElement): void {
  el.transformMatrix = [1, 0, 0, 1, 0, 0];
  // @ts-expect-error five numbers is not a transform matrix
  el.transformMatrix = [1, 0, 0, 1, 0];
  // @ts-expect-error seven numbers is not a transform matrix
  el.transformMatrix = [1, 0, 0, 1, 0, 0, 0];
  // @ts-expect-error a widened number[] no longer satisfies the tuple
  el.transformMatrix = [1, 0, 0, 1, 0, 0].map((n) => n);

  // `inlineSvg` is optional: a layer literal without it compiles.
  const layer: Layer = {
    id: "l",
    name: "L",
    type: "default",
    visible: true,
    opacity: 100,
    elements: [],
  };
  void layer;
}
void changedShapesAreExact;

function issuesOf(fn: () => unknown): { path: string; message: string }[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof IRValidationError) return error.issues;
    throw error;
  }
  throw new Error("expected IRValidationError");
}

function makeAsset(overrides: Partial<Asset> & { id: string; artboardId: string }): Asset {
  return {
    path: `${overrides.id}.png`,
    mimeType: "image/png",
    width: 10,
    height: 10,
    exportParams: { format: "png", scale: 1 },
    ...overrides,
  };
}

describe("loadAndValidateIR", () => {
  it("accepts a valid single-artboard document", () => {
    const doc = loadAndValidateIR(loadFixture("single-artboard-basic.json"));
    expect(doc.artboards).toHaveLength(1);
    expect(doc.artboards[0].name).toBe("desktop");
    expect(doc.metadata.slug).toBe("test-graphic");
  });

  it("accepts a valid multi-artboard document", () => {
    const doc = loadAndValidateIR(loadFixture("multi-artboard-responsive.json"));
    expect(doc.artboards).toHaveLength(3);
  });

  it("rejects empty object", () => {
    expect(() => loadAndValidateIR({})).toThrow(IRValidationError);
  });

  it("rejects document with no artboards", () => {
    const invalid = loadFixture("single-artboard-basic.json");
    invalid.artboards = [];
    expect(() => loadAndValidateIR(invalid)).toThrow(IRValidationError);
  });

  it("rejects document with invalid text element", () => {
    const invalid = loadFixture("single-artboard-basic.json");
    invalid.artboards[0].layers[0].elements[0].paragraphs = [];
    expect(() => loadAndValidateIR(invalid)).toThrow(IRValidationError);
  });

  it("rejects document with missing slug", () => {
    const invalid = loadFixture("single-artboard-basic.json");
    invalid.metadata.slug = "";
    expect(() => loadAndValidateIR(invalid)).toThrow(IRValidationError);
  });

  it("rejects duplicate artboard IDs", () => {
    const invalid = loadFixture("multi-artboard-responsive.json");
    invalid.artboards[1].id = invalid.artboards[0].id;
    expect(() => loadAndValidateIR(invalid)).toThrow(/Duplicate artboard id/);
  });

  it("rejects assets that reference missing artboards or layers", () => {
    const invalidArtboard = loadFixture("single-artboard-basic.json");
    invalidArtboard.assets[Object.keys(invalidArtboard.assets)[0]].artboardId = "missing";
    expect(() => loadAndValidateIR(invalidArtboard)).toThrow(/unknown artboard id/);

    const invalidLayer = loadFixture("single-artboard-basic.json");
    invalidLayer.assets[Object.keys(invalidLayer.assets)[0]].layerId = "missing";
    expect(() => loadAndValidateIR(invalidLayer)).toThrow(/unknown layer id/);
  });

  it("accepts arbitrary metadata fields as passthrough", () => {
    const input = loadFixture("single-artboard-basic.json");
    input.metadata.headline = "My Big Story";
    input.metadata.credit = "Graphics Dept";
    input.metadata.customField = "custom-value";
    input.metadata.nested = { foo: [1, 2, 3], bar: true };

    const doc = loadAndValidateIR(input);
    expect(doc.metadata.headline).toBe("My Big Story");
    expect(doc.metadata.credit).toBe("Graphics Dept");
    expect(doc.metadata.customField).toBe("custom-value");
    expect(doc.metadata.nested).toEqual({ foo: [1, 2, 3], bar: true });
  });

  it("rejects non-JSON-serializable metadata values", () => {
    const input = loadFixture("single-artboard-basic.json");
    // Zod catchall rejects values that aren't valid JSON types
    input.metadata.bad = undefined;
    expect(() => loadAndValidateIR(input)).toThrow(IRValidationError);
  });
});

describe("closed, finite validation (§4.1)", () => {
  it("rejects an unknown nested field with its full path", () => {
    const input = loadFixture("single-artboard-basic.json");
    input.artboards[0].layers[0].elements[0].mysteryField = 1;
    const issues = issuesOf(() => loadAndValidateIR(input));
    expect(issues[0].path).toBe("artboards.0.layers.0.elements.0");
    expect(issues[0].message).toContain("mysteryField");
  });

  it("rejects an unknown top-level document field", () => {
    const input = loadFixture("single-artboard-basic.json");
    input.extraDocumentField = true;
    expect(() => loadAndValidateIR(input)).toThrow(/extraDocumentField/);
  });

  it("keeps metadata and source open for arbitrary keys", () => {
    const input = loadFixture("single-artboard-basic.json");
    input.metadata.anything = { nested: [1, 2, 3] };
    input.source.figmaFileKey = "abc123";
    expect(() => loadAndValidateIR(input)).not.toThrow();
  });

  it("rejects Infinity where bounds do not already", () => {
    for (const mutate of [
      (doc: any) => (doc.artboards[0].layers[0].elements[0].position.x = Infinity),
      (doc: any) =>
        (doc.artboards[0].layers[0].elements[0].paragraphs[0].runs[0].fontSize = Infinity),
      (doc: any) =>
        (doc.artboards[0].layers[0].elements[0].paragraphs[0].runs[0].letterSpacing = -Infinity),
      (doc: any) => (doc.artboards[0].width = Infinity),
    ]) {
      const input = loadFixture("single-artboard-basic.json");
      mutate(input);
      expect(() => loadAndValidateIR(input)).toThrow(/finite/);
    }
  });

  it("requires transformMatrix to be exactly six numbers", () => {
    const input = loadFixture("single-artboard-basic.json");
    input.artboards[0].layers[0].elements[0].transformMatrix = [1, 0, 0, 1, 0];
    expect(() => loadAndValidateIR(input)).toThrow(IRValidationError);

    const valid = loadFixture("single-artboard-basic.json");
    valid.artboards[0].layers[0].elements[0].transformMatrix = [1, 0, 0, 1, 12.5, -3];
    expect(() => loadAndValidateIR(valid)).not.toThrow();

    const tooMany = loadFixture("single-artboard-basic.json");
    tooMany.artboards[0].layers[0].elements[0].transformMatrix = [1, 0, 0, 1, 0, 0, 0];
    expect(() => loadAndValidateIR(tooMany)).toThrow(IRValidationError);
  });

  it("accepts inlineSvg only on svg layers", () => {
    // Absent everywhere: fine (every fixture is already like this).
    const absent = loadFixture("single-artboard-basic.json");
    expect(() => loadAndValidateIR(absent)).not.toThrow();

    // Present on a non-svg layer: rejected even as `false`.
    const onDefault = loadFixture("single-artboard-basic.json");
    onDefault.artboards[0].layers[0].inlineSvg = false;
    const issues = issuesOf(() => loadAndValidateIR(onDefault));
    expect(issues[0].path).toBe("artboards.0.layers.0.inlineSvg");

    // Present on an svg layer: valid (the inline fixture carries `true`).
    const onSvg = loadFixture("svg-layer-inline.json");
    expect(() => loadAndValidateIR(onSvg)).not.toThrow();
  });
});

describe("semantic checks (§4.2)", () => {
  it("rejects an own __proto__ key on the raw assets record before Zod can drop it", () => {
    const input = loadFixture("single-artboard-basic.json");
    // JSON.parse creates `__proto__` as an ordinary own data property.
    input.assets = JSON.parse(
      `{"__proto__": {"id": "__proto__", "path": "x.png", "mimeType": "image/png", "width": 10, "height": 10, "artboardId": "${input.artboards[0].id}", "exportParams": {"format": "png", "scale": 1}}}`,
    );
    const issues = issuesOf(() => loadAndValidateIR(input));
    expect(issues[0].path).toBe("assets.__proto__");
    expect(issues[0].message).toContain("__proto__");
  });

  it("still accepts constructor and toString as asset ids", () => {
    const input = loadFixture("single-artboard-basic.json");
    const artboardId = input.artboards[0].id;
    const layerId = input.artboards[0].layers[0].id;
    input.assets = {
      constructor: makeAsset({ id: "constructor", artboardId }),
      toString: makeAsset({ id: "toString", artboardId, layerId }),
    };
    expect(() => loadAndValidateIR(input)).not.toThrow();
  });

  it("rejects duplicate html-rendered text element ids within an artboard", () => {
    const input = loadFixture("single-artboard-basic.json");
    const layer = input.artboards[0].layers[0];
    layer.elements.push(JSON.parse(JSON.stringify(layer.elements[0])));
    const issues = issuesOf(() => loadAndValidateIR(input));
    expect(issues[0].path).toMatch(/^artboards\.0\.layers\.0\.elements\.\d+\.id$/);
    expect(issues[0].message).toContain("Duplicate html-rendered text element id");
  });

  it("exempts image-rendered text from the id-uniqueness check", () => {
    // Image-rendered text produces no DOM node, so its id never becomes a DOM id.
    const input = loadFixture("single-artboard-basic.json");
    const layer = input.artboards[0].layers[0];
    layer.elements.push(JSON.parse(JSON.stringify(layer.elements[0])));
    for (const el of layer.elements) {
      if (el.type === "text") el.renderAs = "image";
    }
    // The fixture has a background asset, so the image-text check passes too.
    expect(() => loadAndValidateIR(input)).not.toThrow();
  });

  it("allows the same text id on two different artboards", () => {
    const input = loadFixture("multi-artboard-responsive.json");
    const [first, second] = input.artboards;
    const el = first.layers[0].elements.find((e: { type: string }) => e.type === "text");
    expect(el).toBeDefined();
    el.id = "shared-across-artboards";
    const copy = JSON.parse(JSON.stringify(el));
    second.layers[0].elements.push(copy);
    expect(() => loadAndValidateIR(input)).not.toThrow();
  });

  it("rejects a second background asset for one artboard", () => {
    const input = loadFixture("single-artboard-basic.json");
    input.assets["second-bg"] = makeAsset({ id: "second-bg", artboardId: input.artboards[0].id });
    const issues = issuesOf(() => loadAndValidateIR(input));
    expect(issues[0].path).toBe("assets.second-bg");
    expect(issues[0].message).toContain("more than one background asset");
  });

  it("rejects a second asset for one (artboardId, layerId) scope", () => {
    const input = loadFixture("png-layer-overlay.json");
    const scoped = Object.values(input.assets).find(
      (asset): asset is Asset => (asset as Asset).layerId !== undefined,
    );
    expect(scoped).toBeDefined();
    input.assets["dupe-scope"] = makeAsset({
      id: "dupe-scope",
      artboardId: scoped!.artboardId,
      layerId: scoped!.layerId,
    });
    const issues = issuesOf(() => loadAndValidateIR(input));
    expect(issues[0].message).toContain("more than one asset");
  });

  it("rejects a visible png or non-inline svg layer with no layer asset", () => {
    const input = loadFixture("single-artboard-basic.json");
    input.artboards[0].layers.push({
      id: "overlay-png",
      name: "overlay",
      type: "png",
      visible: true,
      opacity: 100,
      elements: [],
    });
    const issues = issuesOf(() => loadAndValidateIR(input));
    expect(issues[0].path).toBe("artboards.0.layers.1");
    expect(issues[0].message).toContain("has no asset");

    const svgInput = loadFixture("single-artboard-basic.json");
    svgInput.artboards[0].layers.push({
      id: "overlay-svg",
      name: "overlay",
      type: "svg",
      visible: true,
      opacity: 100,
      elements: [],
    });
    expect(() => loadAndValidateIR(svgInput)).toThrow(/has no asset/);
  });

  it("exempts hidden and inline-svg layers from the layer-asset check", () => {
    const hidden = loadFixture("single-artboard-basic.json");
    hidden.artboards[0].layers.push({
      id: "overlay-png",
      name: "overlay",
      type: "png",
      visible: false,
      opacity: 100,
      elements: [],
    });
    expect(() => loadAndValidateIR(hidden)).not.toThrow();

    const inline = loadFixture("single-artboard-basic.json");
    inline.artboards[0].layers.push({
      id: "overlay-svg",
      name: "overlay",
      type: "svg",
      inlineSvg: true,
      visible: true,
      opacity: 100,
      elements: [{ type: "rawHtml", content: "<svg></svg>" }],
    });
    expect(() => loadAndValidateIR(inline)).not.toThrow();
  });

  it("rejects renderAs image text on an artboard with no background asset", () => {
    const input = loadFixture("single-artboard-basic.json");
    input.assets = {};
    for (const layer of input.artboards[0].layers) {
      for (const el of layer.elements) {
        if (el.type === "text") el.renderAs = "image";
      }
    }
    const issues = issuesOf(() => loadAndValidateIR(input));
    expect(issues[0].path).toBe("artboards.0");
    expect(issues[0].message).toContain("no background asset");
  });

  it("accepts renderAs image text when the background asset exists", () => {
    const input = loadFixture("single-artboard-basic.json");
    for (const layer of input.artboards[0].layers) {
      for (const el of layer.elements) {
        if (el.type === "text") el.renderAs = "image";
      }
    }
    expect(() => loadAndValidateIR(input)).not.toThrow();
  });
});
