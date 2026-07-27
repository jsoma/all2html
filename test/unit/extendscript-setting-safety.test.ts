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
