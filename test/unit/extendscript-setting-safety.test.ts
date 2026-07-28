import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { relativeOutputDirectory } from "../../src/core/artifact-path.js";
import { processAndEmit } from "../../src/extendscript/index.js";
import { SAFE_SETTING_IDENTIFIER_RE } from "../../src/ir/schema.js";
import {
  SAFE_SETTING_IDENTIFIER_RE as DEFINITIONS_RE,
  getSettingDefault,
  isValidSettingValue,
  SAFE_IDENTIFIER_SETTING_KEYS,
} from "../../src/ir/settings-definitions.js";
import type { Document } from "../../src/ir/types.js";
import { loadAndValidateIR } from "../../src/ir/validate.js";

/**
 * `namespace` and `projectName` are declared `string-safe` and Zod refuses a
 * metacharacter in either — but the production Illustrator surface never runs
 * Zod. `exporter.jsx` copies the value out of the `ai2html-settings` text block
 * straight into `settings`, and `src/emitters/shared/css.ts` concatenates it into
 * every selector unescaped, so `g-}body{display:none}.` used to close the rule
 * and inject arbitrary CSS into the desk's page.
 *
 * These exercise the real ExtendScript entry point, which is the only shared
 * chokepoint every Zod-free caller passes through.
 */

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function loadDoc(settings?: Partial<Document["settings"]>): Document {
  const doc: Document = JSON.parse(
    readFileSync(resolve(fixturesDir, "single-artboard-basic.json"), "utf-8"),
  );
  // The fixture already pins `namespace`, and document settings win over the
  // inline config — which is exactly how `exporter.jsx` delivers the text-block
  // value, so this is the realistic injection route.
  if (settings) doc.settings = { ...doc.settings, ...settings };
  return doc;
}

const INJECTION = "g-}body{display:none}.";

describe("the pattern has one definition", () => {
  it("is the same object in schema.ts and settings-definitions.ts", () => {
    // A forked copy is how the two paths would drift apart again.
    expect(SAFE_SETTING_IDENTIFIER_RE).toBe(DEFINITIONS_RE);
  });

  it("covers exactly the settings declared string-safe", () => {
    expect([...SAFE_IDENTIFIER_SETTING_KEYS].sort()).toEqual([
      "namespace",
      "projectName",
      "svgIdPrefix",
    ]);
  });
});

describe("the ExtendScript path rejects unsafe identifier settings (no Zod runs there)", () => {
  it("warns and falls back instead of concatenating a namespace into CSS", () => {
    const result = processAndEmit(loadDoc({ namespace: INJECTION }));

    const warning = result.structuredWarnings.find((w) => w.code === "setting:invalid-value");
    expect(warning).toBeDefined();
    expect(warning?.category).toBe("setting");
    expect(warning?.setting).toBe("namespace");
    expect(warning?.surface).toBe("illustrator");
    // The plain-string projection carries it too — that is what the panel reads.
    expect(result.warnings.some((message) => message.includes("namespace"))).toBe(true);

    // The injected rule never reaches the output, in any form.
    expect(result.html).not.toContain("body{display:none}");
    expect(result.html).not.toContain(INJECTION);
    // And the default took its place, so the graphic still renders.
    expect(result.html).toContain(`class="${getSettingDefault("namespace")}artboard"`);
  });

  it("applies every constraint in the settings table, not only identifier constraints", () => {
    const result = processAndEmit(
      loadDoc({
        output: "not-a-mode",
        jpgQuality: 999,
        imageFormat: ["png", "not-a-format"],
      } as unknown as Partial<Document["settings"]>),
    );

    expect(result.structuredWarnings.filter((w) => w.code === "setting:invalid-value")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ setting: "output" }),
        expect.objectContaining({ setting: "jpgQuality" }),
        expect.objectContaining({ setting: "imageFormat" }),
      ]),
    );
    expect(result.files).toHaveLength(1);
  });

  it("applies the same guard to projectName", () => {
    const result = processAndEmit(loadDoc(), {
      settings: { projectName: "x{}*/;alert(1);/*" },
    });

    const warning = result.structuredWarnings.find(
      (w) => w.code === "setting:invalid-value" && w.setting === "projectName",
    );
    expect(warning).toBeDefined();
    expect(result.html).not.toContain("alert(1)");
  });

  it("guards the inline config path too, not only document settings", () => {
    // The panel and `all2html.config.json` arrive through the config argument;
    // the text block arrives on `irDoc.settings`. The guard sits after the merge
    // so both are covered.
    const result = processAndEmit(loadDoc(), { settings: { svgIdPrefix: INJECTION } });
    expect(
      result.structuredWarnings.some(
        (w) => w.code === "setting:invalid-value" && w.setting === "svgIdPrefix",
      ),
    ).toBe(true);
  });

  it("leaves safe values, including the empty string, untouched and unwarned", () => {
    const result = processAndEmit(loadDoc({ namespace: "ns_1-", projectName: "" }));

    expect(result.structuredWarnings.filter((w) => w.code === "setting:invalid-value")).toEqual([]);
    expect(result.html).toContain('class="ns_1-artboard"');
  });
});

/**
 * The other half of the settings boundary: a value that is perfectly *valid* and
 * that this surface will not act on. "A surface must not accept a setting it does
 * not honor" is enforced by `checkSurfaceCapabilities`, and `processAndEmit` is
 * the only place the Illustrator surface calls it — but nothing asserted the call
 * site. Replacing the push loop in `src/extendscript/index.ts` with
 * `void capabilityWarnings;` left the whole suite green while every dead cell on
 * the production surface went silent again.
 *
 * `capabilities.test.ts` covers the declaration table; this covers the wiring.
 */
describe("the Illustrator surface warns for settings it does not honor", () => {
  it("emits a setting:unsupported warning per unhonored setting, tagged illustrator", () => {
    const result = processAndEmit(loadDoc({ svgIdPrefix: "pfx", writeImageFiles: false }));

    const unsupported = result.structuredWarnings.filter((w) => w.code === "setting:unsupported");
    expect(unsupported.map((w) => w.setting).sort()).toEqual(["svgIdPrefix", "writeImageFiles"]);
    for (const warning of unsupported) {
      expect(warning.category).toBe("setting");
      expect(warning.surface).toBe("illustrator");
    }
    // The plain-string projection carries them — that is what the panel renders.
    expect(result.warnings.filter((message) => message.includes("does not honor"))).toHaveLength(2);
  });

  it("stays silent for a document that asks for nothing this surface refuses", () => {
    const result = processAndEmit(loadDoc());

    expect(result.structuredWarnings.filter((w) => w.code === "setting:unsupported")).toEqual([]);
  });
});

/**
 * The slug is not a setting, but `groupArtboards` falls back to
 * `metadata.slug` when `projectName` is absent — including when the sanitizer
 * above just cleared an invalid one — and the exporter concatenates the
 * resulting per-file slug into the output path at its write site. So an unsafe
 * slug was a path traversal, not just a CSS problem: clearing `projectName`
 * routed the attack straight to the fallback.
 */
describe("the document slug cannot escape the output directory", () => {
  const TRAVERSAL = "../../pwn";

  it("sanitizes a traversal slug and warns", () => {
    const doc = loadDoc();
    doc.metadata = { ...doc.metadata, slug: TRAVERSAL };
    const result = processAndEmit(doc);

    for (const file of result.files) {
      expect(file.slug).not.toContain("..");
      expect(file.slug).not.toContain("/");
    }
    expect(result.structuredWarnings.some((w) => w.code === "setting:invalid-value")).toBe(true);
  });

  it("closes the projectName-cleared fallback route", () => {
    // Both carry the attack, exactly as exporter.jsx used to produce them:
    // project_name was copied raw into settings.projectName AND metadata.slug.
    const doc = loadDoc({ projectName: TRAVERSAL });
    doc.metadata = { ...doc.metadata, slug: TRAVERSAL };
    const result = processAndEmit(doc);

    for (const file of result.files) {
      expect(file.slug).not.toMatch(/\.\.|\//);
    }
  });

  it("leaves an already-safe slug alone", () => {
    const doc = loadDoc();
    doc.metadata = { ...doc.metadata, slug: "countries-2024" };
    const result = processAndEmit(doc);

    expect(result.structuredWarnings.filter((w) => w.code === "setting:invalid-value")).toEqual([]);
  });
});

/**
 * Everything above guards the document the *core* renders. `exporter.jsx` also
 * writes `ir.json` to disk, and it writes it **before** `processAndEmit` runs —
 * so the core's repair never reached the file. With `project_name: "../../pwn"`
 * the emitted HTML was safe and the persisted document still carried the raw
 * value, which means `loadAndValidateIR` rejects a document all2html produced
 * itself. That is the contract break, and it can only be caught on the exporter
 * side.
 *
 * The exporter is ExtendScript and cannot be imported, so this evaluates the
 * real functions out of the shipped file — the same technique
 * `illustrator-warning-plumbing.test.ts` uses, and for the same reason: a
 * re-implementation here would drift from what ships.
 */
describe("the ir.json exporter.jsx persists is canonical", () => {
  const exporterSource = readFileSync(
    resolve(import.meta.dirname, "../../plugins/illustrator/exporter.jsx"),
    "utf-8",
  );

  function extract(pattern: RegExp): string {
    const match = exporterSource.match(pattern);
    if (!match) throw new Error(`Could not find ${pattern} in exporter.jsx`);
    return match[0];
  }

  interface CanonicalBuild {
    settings: Record<string, unknown>;
    warnings: string[];
  }

  const runCanonicalSettings = new Function(
    "docSettings",
    "All2Html",
    [
      "var warnings = [];",
      "function warn(message) { warnings.push(message); }",
      extract(/function hasOwn\(obj, key\) \{[\s\S]*?\n\}/),
      extract(/function makeKeyword\(name\) \{[\s\S]*?\n\}/),
      extract(/function readBoolSetting\(obj, key\) \{[\s\S]*?\n\}/),
      extract(/function readIntSetting\(obj, key\) \{[\s\S]*?\n\}/),
      extract(/function readNullableIntSetting\(obj, key\) \{[\s\S]*?\n\}/),
      extract(/function readStringSetting\(obj, key\) \{[\s\S]*?\n\}/),
      extract(/function buildCanonicalIrSettings\(docSettings\) \{[\s\S]*?\n\}/),
      extract(/function sanitizeCanonicalSettings\(settings\) \{[\s\S]*?\n\}/),
      "var settings = buildCanonicalIrSettings(docSettings);",
      "sanitizeCanonicalSettings(settings);",
      "return { settings: settings, warnings: warnings };",
    ].join("\n"),
  ) as (
    docSettings: Record<string, string>,
    core: { isValidSettingValue: typeof isValidSettingValue },
  ) => CanonicalBuild;

  function buildCanonicalSettings(docSettings: Record<string, string>): CanonicalBuild {
    return runCanonicalSettings(docSettings, { isValidSettingValue });
  }

  /** The document the exporter would write, assembled the way `runExporter` does. */
  function persistedDocument(docSettings: Record<string, string>): {
    doc: unknown;
    warnings: string[];
  } {
    const built = buildCanonicalSettings(docSettings);
    const doc = loadDoc();
    // metadata.slug is `makeKeyword(project_name || docName)` at the write site.
    doc.metadata = {
      ...doc.metadata,
      slug: built.settings.projectName ? String(built.settings.projectName) : "sample",
    };
    return {
      doc: { ...doc, settings: built.settings as Document["settings"] },
      warnings: built.warnings,
    };
  }

  it("keeps a traversal project_name out of the file it writes", () => {
    const { doc, warnings } = persistedDocument({ project_name: "../../pwn" });

    // The whole point: our own validator accepts the document we just wrote.
    const validated = loadAndValidateIR(doc);
    expect(validated.settings.projectName).toBe("pwn");
    expect(JSON.stringify(validated.settings)).not.toContain("..");
    // Keyword-casing is what `slug` already did, so no warning is owed and the
    // emitted output is unchanged.
    expect(warnings).toEqual([]);
  });

  it("drops a namespace it cannot repair, and says so", () => {
    const { doc, warnings } = persistedDocument({ namespace: INJECTION });

    const validated = loadAndValidateIR(doc);
    // Absent, not keyword-cased into a prefix nobody asked for: the declared
    // default applies, exactly as the core's sanitizer does with it.
    expect("namespace" in validated.settings).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("namespace");
    expect(warnings[0]).toContain(INJECTION);
  });

  it("drops a project_name with no identifier left in it", () => {
    // makeKeyword("2020 election") is "2020-election", which is a *legal slug*
    // and an *illegal* CSS identifier — the leading digit is the case a plain
    // keyword-casing would have persisted unvalidated.
    for (const value of ["2020 election", "///"]) {
      const { doc, warnings } = persistedDocument({ project_name: value });
      expect(() => loadAndValidateIR(doc)).not.toThrow();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("projectName");
    }
  });

  it("leaves every already-canonical value exactly as typed", () => {
    const { doc, warnings } = persistedDocument({
      project_name: "countries-2024",
      namespace: "g-",
      svg_id_prefix: "svg_",
    });

    const validated = loadAndValidateIR(doc);
    expect(validated.settings.projectName).toBe("countries-2024");
    expect(validated.settings.namespace).toBe("g-");
    expect(validated.settings.svgIdPrefix).toBe("svg_");
    expect(warnings).toEqual([]);
  });

  it("drops every invalid setting kind before writing ir.json", () => {
    const { doc, warnings } = persistedDocument({
      output: "not-a-mode",
      jpg_quality: "999",
      image_format: "png,not-a-format",
    });

    const validated = loadAndValidateIR(doc);
    expect(validated.settings.output).toBeUndefined();
    expect(validated.settings.jpgQuality).toBeUndefined();
    expect(validated.settings.imageFormat).toBeUndefined();
    expect(warnings).toHaveLength(3);
  });

  it("rejects the document the exporter used to write, so this test can fail", () => {
    // The pre-fix behavior, spelled out: the raw value straight into settings.
    const doc = { ...loadDoc(), settings: { projectName: "../../pwn" } };
    expect(() => loadAndValidateIR(doc)).toThrow();
  });
});

/**
 * The exporter's own output directory, executed out of the shipped `.jsx`.
 *
 * `relativeOutputDirectory` rejecting traversal is proven in
 * `artifact-path.test.ts`, and the bundle re-exporting it is proven in
 * `surface-entrypoints.test.ts` — but neither notices if `exporter.jsx` stops
 * *calling* it. Deleting that one call left both green while
 * `html_output_path: "../../outside"` wrote above the document directory again.
 * So this runs the real `resolveDocumentOutputPath` against the real
 * constructor: remove the call and the traversal case stops throwing.
 */
describe("the Illustrator output directory is constructed, not concatenated", () => {
  const exporterSource = readFileSync(
    resolve(import.meta.dirname, "../../plugins/illustrator/exporter.jsx"),
    "utf-8",
  );

  const match = exporterSource.match(
    /function resolveDocumentOutputPath\(settings, docPath\) \{[\s\S]*?\n\}/,
  );
  if (!match) throw new Error("Could not find resolveDocumentOutputPath in exporter.jsx");

  const resolveOutputPath = new Function(
    "settings",
    "docPath",
    "All2Html",
    `${match[0]}\nreturn resolveDocumentOutputPath(settings, docPath);`,
  ) as (
    settings: Record<string, unknown>,
    docPath: string,
    core: { relativeOutputDirectory: (value: string) => string },
  ) => string;

  const core = { relativeOutputDirectory };

  it("refuses a traversing htmlOutputPath", () => {
    expect(() => resolveOutputPath({ htmlOutputPath: "../../outside" }, "/docs/", core)).toThrow(
      /Artifact paths must stay inside/,
    );
  });

  it("refuses a traversing imageOutputPath fallback", () => {
    expect(() => resolveOutputPath({ imageOutputPath: "../evil" }, "/docs/", core)).toThrow(
      /Artifact paths must stay inside/,
    );
  });

  it("contains a leading slash under the document directory", () => {
    expect(resolveOutputPath({ htmlOutputPath: "/all2html-output/" }, "/docs/", core)).toBe(
      "/docs/all2html-output/",
    );
  });

  it("still produces the default directory with one trailing slash", () => {
    expect(resolveOutputPath({}, "/docs/", core)).toBe("/docs/all2html-output/");
  });
});
