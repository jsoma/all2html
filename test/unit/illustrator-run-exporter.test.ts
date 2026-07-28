import { describe, expect, it } from "vitest";
import { loadAndValidateIR } from "../../src/ir/validate.js";
import {
  emittedHtml,
  type FakeDocumentSpec,
  runIllustratorExporter,
} from "../helpers/illustrator-fake-dom.js";

/**
 * `runExporter()` executed against a fake Illustrator DOM.
 *
 * Every other Illustrator test pulls a named function out of `exporter.jsx` and
 * calls it itself, which proves the function body and never proves the exporter
 * still calls it. Four guards were deletable with the whole suite green on that
 * basis. Each `it` below names the call site it pins, and each was verified by
 * applying the mutation and watching this file go red.
 */

const baseSpec: FakeDocumentSpec = {
  name: "countries.ai",
  path: "/docs",
  artboards: [{ name: "chart" }],
  layers: [{ name: "Layer 1" }],
  textFrames: [{ contents: "Chart Title" }],
};

function run(overrides: Partial<FakeDocumentSpec> = {}) {
  return runIllustratorExporter({ ...baseSpec, ...overrides });
}

describe("runExporter end to end", () => {
  it("writes ir.json, one HTML file, and one artboard image", () => {
    const result = run();

    expect(result.envelope.success, result.envelope.error).toBe(true);
    expect(result.envelope.outputPath).toBe("/docs/all2html-output/");
    expect(result.envelope.slug).toBe("countries");
    expect([...emittedHtml(result).keys()]).toEqual(["countries.html"]);
    expect(emittedHtml(result).get("countries.html")).toContain("Chart Title");

    // ir.json is a document our own validator accepts.
    expect(() => loadAndValidateIR(result.irDocument)).not.toThrow();

    const images = result.exports.filter((entry) => entry.type !== "ExportType.SVG");
    expect(images).toHaveLength(1);
    expect(images[0].path).toBe("/docs/all2html-output/countries-chart");
    expect(images[0].type).toBe("ExportType.PNG8");
  });
});

/**
 * Pins `resolveDocumentOutputPath(docSettings, docPath)` at the `runExporter`
 * call site. Bypassing it — `docPath + (docSettings.html_output_path || ...)` —
 * left every existing test green.
 */
describe("the output directory the exporter writes to is constructed", () => {
  it("refuses a traversing html_output_path instead of writing above the document", () => {
    const result = run({ settingsBlock: { html_output_path: "../../outside" } });

    expect(result.envelope.success).toBe(false);
    expect(result.envelope.error).toMatch(/Artifact paths must stay inside/);
    expect([...result.writes.keys()]).toEqual([]);
    expect(result.exports).toEqual([]);
  });

  it("still honors an ordinary html_output_path", () => {
    const result = run({ settingsBlock: { html_output_path: "public/embed" } });

    expect(result.envelope.outputPath).toBe("/docs/public/embed/");
    expect([...result.writes.keys()]).toContain("/docs/public/embed/countries.html");
  });
});

/**
 * Pins `sanitizeCanonicalSettings(canonicalIrSettings)` at the `runExporter` call
 * site, and the single-source rule behind it: the settings the export *runs on*
 * and the settings it *persists* come from the same validated object.
 */
describe("one validated settings source feeds both ir.json and the export run", () => {
  it("repairs project_name before writing it, and names the files with the repair", () => {
    const result = run({ settingsBlock: { project_name: "../../pwn" } });

    const validated = loadAndValidateIR(result.irDocument);
    expect(validated.settings.projectName).toBe("pwn");
    expect(JSON.stringify(validated.settings)).not.toContain("..");
    expect([...emittedHtml(result).keys()]).toEqual(["pwn.html"]);
  });

  it("drops an invalid image_format from the *export*, not only from ir.json", () => {
    // The defect: `gif` was stripped from the canonical settings and still
    // reached `exportParams.format` through the separate, unsanitized bag —
    // producing an ir.json that violates our own schema.
    const result = run({ settingsBlock: { image_format: "gif" } });

    const validated = loadAndValidateIR(result.irDocument);
    expect(validated.settings.imageFormat).toBeUndefined();
    expect(JSON.stringify(validated.assets)).not.toContain("gif");
    for (const asset of Object.values(validated.assets)) {
      expect(asset.exportParams?.format).toBe("png");
      expect(asset.mimeType).toBe("image/png");
    }
    expect(result.exports.map((entry) => entry.type)).toEqual(["ExportType.PNG8"]);
    expect(
      result.envelope.structuredWarnings.some(
        (warning) =>
          warning.code === "setting:invalid-value" && warning.message.includes("imageFormat"),
      ),
    ).toBe(true);
  });

  it("drops an out-of-range jpg_quality from the export options too", () => {
    const result = run({ settingsBlock: { image_format: "jpg", jpg_quality: "999" } });

    const validated = loadAndValidateIR(result.irDocument);
    expect(validated.settings.jpgQuality).toBeUndefined();
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0].type).toBe("ExportType.JPEG");
    // The declared default, which is what ir.json records: the file on disk and
    // the record describing it cannot disagree.
    expect(result.exports[0].options.qualitySetting).toBe(85);
    for (const asset of Object.values(validated.assets)) {
      expect(asset.exportParams?.quality).toBe(85);
    }
  });

  it("drops an out-of-range png_number_of_colors from the export options too", () => {
    const result = run({ settingsBlock: { png_number_of_colors: "9999" } });

    expect(result.exports[0].options.colorCount).toBe(128);
    expect(loadAndValidateIR(result.irDocument).settings.pngNumberOfColors).toBeUndefined();
  });

  it("passes valid values straight through to both", () => {
    const result = run({
      settingsBlock: { image_format: "jpg", jpg_quality: "60", use_2x_images_if_possible: "false" },
    });

    const validated = loadAndValidateIR(result.irDocument);
    expect(validated.settings.jpgQuality).toBe(60);
    expect(result.exports[0].options.qualitySetting).toBe(60);
    expect(result.exports[0].options.horizontalScale).toBe(100);
    for (const asset of Object.values(validated.assets)) {
      expect(asset.exportParams?.quality).toBe(60);
      expect(asset.exportParams?.scale).toBe(1);
    }
  });
});

/**
 * Pins the `result.files` write loop. Truncating it to `emittedFiles[0]` left
 * every existing test green, because the only multiple-files coverage stopped at
 * the core's return value.
 */
describe("output: multiple-files writes one file per artboard group", () => {
  // Distinct widths: in one-file mode every artboard lands in one responsive
  // group, and duplicate widths inside a group are a hard error.
  const multi: Partial<FakeDocumentSpec> = {
    artboards: [{ name: "chart" }, { name: "map", rect: [700, 0, 1600, -400] }],
    textFrames: [
      { contents: "Chart Title" },
      { contents: "Map Title", bounds: [710, -10, 890, -40] },
    ],
  };

  it("writes both group files", () => {
    const result = run({ ...multi, settingsBlock: { output: "multiple-files" } });

    expect([...emittedHtml(result).keys()].sort()).toEqual([
      "countries-chart.html",
      "countries-map.html",
    ]);
    expect(emittedHtml(result).get("countries-chart.html")).toContain("Chart Title");
    expect(emittedHtml(result).get("countries-chart.html")).not.toContain("Map Title");
    expect(emittedHtml(result).get("countries-map.html")).toContain("Map Title");
  });

  it("writes one file in one-file mode, for the same document", () => {
    const result = run(multi);

    expect([...emittedHtml(result).keys()]).toEqual(["countries.html"]);
    expect(emittedHtml(result).get("countries.html")).toContain("Chart Title");
    expect(emittedHtml(result).get("countries.html")).toContain("Map Title");
  });

  it("carries a custom html_output_extension onto every group file", () => {
    const result = run({
      ...multi,
      settingsBlock: { output: "multiple-files", html_output_extension: ".php" },
    });

    expect([...emittedHtml(result).keys()].sort()).toEqual([
      "countries-chart.php",
      "countries-map.php",
    ]);
  });
});

/**
 * Pins `makeKeyword(...)` on the slug. The slug is concatenated into a `File`
 * path for the promo image, where nothing else guards it.
 */
describe("the document slug is keyword-cased before it reaches a File path", () => {
  it("keeps a traversing project_name out of the promo image path", () => {
    const result = run({
      settingsBlock: { project_name: "../../pwn", create_promo_image: "true" },
    });

    const promo = result.exports.filter((entry) => entry.path.indexOf("-promo") >= 0);
    expect(promo).toHaveLength(1);
    expect(promo[0].path).toBe("/docs/pwn-promo");
    for (const entry of result.exports) expect(entry.path).not.toContain("..");
    for (const path of result.writes.keys()) expect(path).not.toContain("..");
  });

  it("honors a validated promo_image_width", () => {
    const result = run({
      settingsBlock: { create_promo_image: "true", promo_image_width: "300" },
    });

    const promo = result.exports.filter((entry) => entry.path.indexOf("-promo") >= 0);
    expect(promo[0].options.horizontalScale).toBe(50);
  });
});

/**
 * Pins the `failedRestores === 0` guard on `docToMarkSaved.saved = true` in
 * `executeAll2Html`. `runRestoreActions()` swallows each failure into an
 * `illustrator:restore-failed` warning, so the save flag was being set on a
 * document the exporter had demonstrably failed to put back — Illustrator then
 * never prompts, and the user closes a file that is still mutated (a special
 * block left hidden, a layer left invisible).
 *
 * The custom block below overlaps the artboard, so the exporter hides it and
 * pushes an unhide restore; `failRestore` makes that restore throw.
 */
describe("a document the exporter could not restore is left dirty", () => {
  const withCssBlock: Partial<FakeDocumentSpec> = {
    textFrames: [
      { contents: "Chart Title" },
      { contents: "all2html-css\n.g-body { color: red; }" },
    ],
  };

  it("marks the document saved when every restore succeeded", () => {
    const result = run(withCssBlock);

    expect(result.envelope.success, result.envelope.error).toBe(true);
    expect(
      result.envelope.structuredWarnings.filter((w) => w.code === "illustrator:restore-failed"),
    ).toEqual([]);
    expect(result.savedAssignments).toEqual([true]);
    expect(result.documentSaved).toBe(true);
  });

  it("does not mark the document saved when a restore failed", () => {
    const result = run({
      textFrames: [
        { contents: "Chart Title" },
        { contents: "all2html-css\n.g-body { color: red; }", failRestore: true },
      ],
    });

    // The export itself still succeeds — the files are written; it is the
    // document state that could not be put back.
    expect(result.envelope.success, result.envelope.error).toBe(true);
    expect(result.savedAssignments).toEqual([]);

    // ...and the user is told why, through the summary the panel renders.
    const restoreWarnings = result.envelope.structuredWarnings.filter(
      (warning) => warning.code === "illustrator:restore-failed",
    );
    expect(restoreWarnings).toHaveLength(1);
    expect(restoreWarnings[0].message).toContain("not marked saved");
    expect(result.envelope.warnings[restoreWarnings[0].category]).toContain(
      restoreWarnings[0].message,
    );
  });

  it("still leaves an already-dirty document dirty", () => {
    const result = run({ ...withCssBlock, saved: false });

    expect(result.savedAssignments).toEqual([]);
    expect(result.documentSaved).toBe(false);
  });
});

/** Settings precedence, executed rather than described: config < panel < text block. */
describe("settings precedence through the real run", () => {
  it("lets the text block win over the panel, and the panel over the config file", () => {
    const result = run({
      configFile: { settings: { html_output_path: "from-config", namespace: "cfg-" } },
      panelSettings: { html_output_path: "from-panel", project_name: "panelname" },
      settingsBlock: { project_name: "blockname" },
    });

    expect(result.envelope.outputPath).toBe("/docs/from-panel/");
    expect(result.envelope.slug).toBe("blockname");
    expect(loadAndValidateIR(result.irDocument).settings.namespace).toBe("cfg-");
  });
});

/**
 * The untyped-input boundary, executed.
 *
 * `all2html.config.json` is `JSON.parse`d and the CEP panel payloads are JSON;
 * neither has a schema, and their values used to be read straight into typed
 * operations at nine call sites. Every case below is a value that reached one of
 * those sites and either persisted a schema-invalid `ir.json` or crashed the
 * export. They assert the policy `normalizeIllustratorInputs` declares — export
 * succeeds, a named warning is raised, the declared fallback applies — and the
 * harness independently validates every persisted document.
 */
describe("untyped config values are normalized once, at the boundary", () => {
  function warningCodes(result: ReturnType<typeof run>): string[] {
    return result.envelope.structuredWarnings.map((warning) => warning.code);
  }

  it("rejects non-string font fields instead of persisting them", () => {
    const result = run({
      configFile: {
        fonts: [{ aifont: "ArialMT", family: 700, style: 1 }],
      },
    });

    expect(result.envelope.success, result.envelope.error).toBe(true);
    expect(warningCodes(result)).toContain("font:invalid-mapping");
    // family falls back to the source font; style is dropped, not stringified.
    expect(loadAndValidateIR(result.irDocument).fonts).toEqual([
      { sourceFont: "ArialMT", family: "ArialMT" },
    ]);
  });

  it("accepts a numeric weight but never a numeric style", () => {
    const result = run({
      configFile: { fonts: [{ sourceFont: "ArialMT", family: "Arial", weight: 700, vshift: -2 }] },
    });

    expect(loadAndValidateIR(result.irDocument).fonts).toEqual([
      { sourceFont: "ArialMT", family: "Arial", weight: "700", vshift: "-2" },
    ]);
  });

  // `[]` is truthy but `String([])` is "", so a fallback applied before
  // normalization lets an array through as exactly the empty string `min(1)`
  // rejects. The check has to be on the normalized value.
  it("does not let an array family become an empty family", () => {
    const result = run({ configFile: { fonts: [{ sourceFont: "ArialMT", family: [] }] } });

    expect(loadAndValidateIR(result.irDocument).fonts).toEqual([
      { sourceFont: "ArialMT", family: "ArialMT" },
    ]);
  });

  it("drops a mapping with no usable source font rather than keying on undefined", () => {
    const result = run({ configFile: { fonts: [{ sourceFont: 42, family: "Arial" }, null] } });

    expect(result.envelope.success, result.envelope.error).toBe(true);
    expect(loadAndValidateIR(result.irDocument).fonts).toEqual([]);
  });

  // The one consumer that crashed rather than warned: compute-styles already
  // guarded a non-string family, its Google Fonts sibling did not.
  it("survives a malformed family with google_fonts enabled", () => {
    const result = run({
      settingsBlock: { google_fonts: "link" },
      configFile: { fonts: [{ sourceFont: "ArialMT", family: 700 }] },
    });

    expect(result.envelope.success, result.envelope.error).toBe(true);
  });

  it("ignores structural metadata values instead of persisting [object Object]", () => {
    const result = run({
      configFile: { settings: { credit: { a: 1 }, headline: 42, alt_text: ["x"] } },
    });

    expect(result.envelope.success, result.envelope.error).toBe(true);
    expect(warningCodes(result)).toContain("metadata:invalid-value");

    const metadata = loadAndValidateIR(result.irDocument).metadata;
    expect(metadata.credit).toBe("");
    expect(metadata.headline).toBe("");
    // An omitted-when-absent field must not appear at all.
    expect("altText" in metadata).toBe(false);
  });

  it("keeps valid metadata strings untouched", () => {
    const result = run({
      configFile: { settings: { credit: "By Somebody", alt_text: "A chart" } },
    });

    const metadata = loadAndValidateIR(result.irDocument).metadata;
    expect(metadata.credit).toBe("By Somebody");
    expect(metadata.altText).toBe("A chart");
  });

  // Every one of these used to produce a different artifact name from the one
  // recorded in settings, or no export at all.
  for (const [label, value] of [
    ["a number", 42],
    ["null", null],
    ["false", false],
    ["zero", 0],
    ["an object", { a: 1 }],
  ] as const) {
    it(`falls back to the document name when project_name is ${label}`, () => {
      const result = run({ configFile: { settings: { project_name: value } } });

      expect(result.envelope.success, result.envelope.error).toBe(true);
      expect(warningCodes(result)).toContain("setting:invalid-value");

      const validated = loadAndValidateIR(result.irDocument);
      expect(validated.settings.projectName).toBeUndefined();
      expect(validated.metadata.slug).toBe("countries");
      expect(result.envelope.slug).toBe("countries");
      expect([...emittedHtml(result).keys()]).toEqual(["countries.html"]);
    });
  }

  // The whole point of the boundary: one accepted value names every artifact.
  it("names settings, metadata, envelope, image and HTML file from one accepted value", () => {
    const result = run({
      settingsBlock: { project_name: "My Project", create_promo_image: "true" },
    });

    const validated = loadAndValidateIR(result.irDocument);
    expect(validated.settings.projectName).toBe("my-project");
    expect(validated.metadata.slug).toBe("my-project");
    expect(result.envelope.slug).toBe("my-project");
    expect([...emittedHtml(result).keys()]).toEqual(["my-project.html"]);

    const imagePaths = result.exports.map((entry) => entry.path);
    expect(imagePaths).toContain("/docs/all2html-output/my-project-chart");
    // The promo image is written beside the .ai file, not under the output dir.
    expect(imagePaths).toContain("/docs/my-project-promo");
  });

  // An output directory the persisted document rejected used to still choose
  // where the run wrote.
  it("does not write to an output path the settings boundary rejected", () => {
    const result = run({ configFile: { settings: { html_output_path: 42 } } });

    expect(result.envelope.success, result.envelope.error).toBe(true);
    expect(result.envelope.outputPath).toBe("/docs/all2html-output/");
    expect(loadAndValidateIR(result.irDocument).settings.htmlOutputPath).toBeUndefined();
  });

  it("honors write_ir as a boolean, not only as the string 'false'", () => {
    expect(run({ configFile: { settings: { write_ir: false } } }).irPath).toBeUndefined();
    expect(run({ settingsBlock: { write_ir: "false" } }).irPath).toBeUndefined();
    expect(run().irPath).toBe("/docs/all2html-output/ir.json");
  });
});

/**
 * Defaults apply only on absence. `jpg_quality: 0` is declared valid
 * (settings-definitions min 0) and layer opacity 0 is a real value; both used
 * to be erased by `|| 85` / `|| 100` at the read site.
 */
describe("a valid zero survives to the export and the IR", () => {
  it("keeps jpg_quality: 0 in the JPEG options and in exportParams", () => {
    const result = run({ settingsBlock: { image_format: "jpg", jpg_quality: "0" } });

    const validated = loadAndValidateIR(result.irDocument);
    expect(validated.settings.jpgQuality).toBe(0);
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0].type).toBe("ExportType.JPEG");
    expect(result.exports[0].options.qualitySetting).toBe(0);
    for (const asset of Object.values(validated.assets)) {
      expect(asset.exportParams?.quality).toBe(0);
    }
  });

  it("keeps a layer's opacity: 0 through the IR and into emitted CSS", () => {
    const result = run({
      layers: [{ name: "Layer 1" }, { name: "art:png", opacity: 0 }],
    });

    expect(result.envelope.success, result.envelope.error).toBe(true);
    const validated = loadAndValidateIR(result.irDocument);
    const pngLayer = validated.artboards[0].layers.find((layer) => layer.type === "png");
    expect(pngLayer?.opacity).toBe(0);
    // html-tree emits `opacity:` on the png layer's <img> only when < 100.
    expect(emittedHtml(result).get("countries.html")).toContain("opacity:0.00");
  });
});

/**
 * The default-layer fallback used to take `layers[0]` with no visibility test,
 * silently attaching extracted text to a `visible: false` layer — content the
 * emitter will skip. It must prefer a visible layer and, when only an
 * invisible one exists, say so.
 */
describe("the default-layer fallback prefers a visible layer", () => {
  it("attaches text to a visible tagged layer over an invisible default layer", () => {
    const result = run({
      layers: [{ name: "notes", visible: false }, { name: "art:div" }],
      textFrames: [{ contents: "Chart Title", layer: "art:div" }],
    });

    expect(result.envelope.success, result.envelope.error).toBe(true);
    const validated = loadAndValidateIR(result.irDocument);
    const [invisible, visible] = validated.artboards[0].layers;
    expect(invisible.visible).toBe(false);
    expect(invisible.elements).toEqual([]);
    expect(visible.visible).toBe(true);
    expect(visible.elements).toHaveLength(1);
    expect(result.envelope.structuredWarnings.map((warning) => warning.code)).not.toContain(
      "layer:invisible-content",
    );
  });

  it("warns when content can only attach to an invisible layer", () => {
    // The frame sits on a settings-named layer, which extractLayers excludes
    // from the layer list — so the only candidate layer is the invisible one.
    const result = run({
      layers: [{ name: "all2html-settings" }, { name: "notes", visible: false }],
      textFrames: [{ contents: "Chart Title", layer: "all2html-settings" }],
    });

    expect(result.envelope.success, result.envelope.error).toBe(true);
    const validated = loadAndValidateIR(result.irDocument);
    expect(validated.artboards[0].layers).toHaveLength(1);
    expect(validated.artboards[0].layers[0].visible).toBe(false);
    expect(validated.artboards[0].layers[0].elements).toHaveLength(1);

    const invisibleWarnings = result.envelope.structuredWarnings.filter(
      (warning) => warning.code === "layer:invisible-content",
    );
    expect(invisibleWarnings).toHaveLength(1);
    expect(invisibleWarnings[0].message).toContain('"notes"');
  });
});

/**
 * Named frames emit `makeKeyword(tf.name)` ids. Copy-pasting a named frame is
 * ordinary authoring, so two same-named frames on ONE artboard dedupe with a
 * numeric suffix and a warning. Cross-artboard duplicates are left alone —
 * the core emitter namespaces those by artboard.
 */
describe("same-artboard duplicate text frame names dedupe", () => {
  it("suffixes the second frame's id and warns", () => {
    const result = run({
      textFrames: [
        { contents: "First", name: "headline" },
        { contents: "Second", name: "headline", bounds: [10, -60, 210, -90] },
        { contents: "Third", name: "headline", bounds: [10, -110, 210, -140] },
      ],
    });

    const validated = loadAndValidateIR(result.irDocument);
    const ids = validated.artboards[0].layers[0].elements.map((element) =>
      element.type === "text" ? element.id : undefined,
    );
    expect(ids).toEqual(["headline", "headline-2", "headline-3"]);

    const duplicateWarnings = result.envelope.structuredWarnings.filter(
      (warning) => warning.code === "text:duplicate-id",
    );
    expect(duplicateWarnings).toHaveLength(2);
    expect(duplicateWarnings[0].message).toContain('"headline"');
  });

  it("leaves same-named frames on different artboards alone", () => {
    const result = run({
      artboards: [{ name: "chart" }, { name: "map", rect: [700, 0, 1600, -400] }],
      textFrames: [
        { contents: "Chart headline", name: "headline" },
        { contents: "Map headline", name: "headline", bounds: [710, -10, 890, -40] },
      ],
    });

    const validated = loadAndValidateIR(result.irDocument);
    for (const artboard of validated.artboards) {
      const element = artboard.layers[0].elements[0];
      expect(element.type).toBe("text");
      expect(element.type === "text" ? element.id : undefined).toBe("headline");
    }
    expect(result.envelope.structuredWarnings.map((warning) => warning.code)).not.toContain(
      "text:duplicate-id",
    );
  });
});

/**
 * One renderAs disposition for extraction AND raster export. A rotated frame
 * under `render_rotated_skewed_text_as: image` produces a renderAs "image"
 * element (so no HTML text) — hideTextFramesForExport must therefore leave it
 * visible during the raster capture, or the text exists nowhere at all.
 */
describe("image-rendered text stays visible during raster export", () => {
  it("keeps a rotated frame visible in the raster and out of the HTML", () => {
    const result = run({
      settingsBlock: { render_rotated_skewed_text_as: "image" },
      textFrames: [
        { contents: "Straight label", name: "straight" },
        { contents: "Rotated label", name: "rotated", rotation: 30, bounds: [10, -60, 210, -90] },
      ],
    });

    expect(result.envelope.success, result.envelope.error).toBe(true);
    const validated = loadAndValidateIR(result.irDocument);
    const elements = validated.artboards[0].layers[0].elements;
    const rotated = elements.find((el) => el.type === "text" && el.id === "rotated");
    const straight = elements.find((el) => el.type === "text" && el.id === "straight");
    if (rotated?.type !== "text" || straight?.type !== "text") {
      throw new Error("expected both text elements in the IR");
    }
    expect(rotated.renderAs).toBe("image");
    expect(rotated.renderAsReason).toBe("rotation");
    expect(rotated.rotation).toBeCloseTo(30);
    expect(rotated.transformMatrix).toHaveLength(6);
    expect(straight.renderAs).toBe("html");

    // At the moment the artboard raster was captured, the html-rendered frame
    // was hidden and the image-rendered frame was still visible.
    const raster = result.exports.find((entry) => entry.type === "ExportType.PNG8");
    expect(raster).toBeDefined();
    expect(raster?.hiddenTextContents).toContain("Straight label");
    expect(raster?.hiddenTextContents).not.toContain("Rotated label");

    // And the HTML carries only the html-rendered frame's text.
    const html = emittedHtml(result).get("countries.html");
    expect(html).toContain("Straight label");
    expect(html).not.toContain("Rotated label");
  });

  it("still keeps every frame visible under the global render_text_as: image", () => {
    const result = run({ settingsBlock: { render_text_as: "image" } });

    const raster = result.exports.find((entry) => entry.type === "ExportType.PNG8");
    expect(raster?.hiddenTextContents).toEqual([]);
  });

  it("hides html-rendered rotated text when the setting says html", () => {
    // Default render_rotated_skewed_text_as is "html": the rotated frame's
    // element renders as HTML, so the raster must NOT contain the text twice.
    const result = run({
      textFrames: [{ contents: "Rotated label", name: "rotated", rotation: 30 }],
    });

    const validated = loadAndValidateIR(result.irDocument);
    const element = validated.artboards[0].layers[0].elements[0];
    expect(element.type === "text" ? element.renderAs : undefined).toBe("html");

    const raster = result.exports.find((entry) => entry.type === "ExportType.PNG8");
    expect(raster?.hiddenTextContents).toContain("Rotated label");
  });
});
