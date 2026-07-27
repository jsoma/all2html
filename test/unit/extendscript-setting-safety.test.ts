import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processAndEmit } from "../../src/extendscript/index.js";
import { SAFE_SETTING_IDENTIFIER_RE } from "../../src/ir/schema.js";
import {
  SAFE_SETTING_IDENTIFIER_RE as DEFINITIONS_RE,
  getSettingDefault,
  SAFE_IDENTIFIER_SETTING_KEYS,
} from "../../src/ir/settings-definitions.js";
import type { Document } from "../../src/ir/types.js";

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
