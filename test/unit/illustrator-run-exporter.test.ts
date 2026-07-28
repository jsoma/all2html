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
