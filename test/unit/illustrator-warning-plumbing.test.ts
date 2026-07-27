import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeGroupedWarnings } from "../../plugins/illustrator/panel/src/shared/types.js";
import { checkSurfaceCapabilities, illustratorCapabilities } from "../../src/core/capabilities.js";
import { WARNING_CATEGORY_ORDER } from "../../src/core/warnings.js";
import { createDefaultSettings } from "../../src/ir/settings-definitions.js";

/**
 * The Illustrator exporter is ExtendScript, so it cannot be imported. These
 * tests read the shipped file and evaluate the one function whose behavior is
 * load-bearing, rather than re-implementing it here — the copy is what let the
 * old substring classifier drift from the core in the first place.
 */
const exporterPath = resolve(import.meta.dirname, "../../plugins/illustrator/exporter.jsx");
const exporterSource = readFileSync(exporterPath, "utf-8");

function extract(pattern: RegExp): string {
  const match = exporterSource.match(pattern);
  if (!match) throw new Error(`Could not find ${pattern} in exporter.jsx`);
  return match[0];
}

interface StructuredLike {
  code: string;
  category: string;
  message: string;
}

function loadGrouper(): (warnings: StructuredLike[]) => Record<string, string[]> {
  const source = [
    extract(/var WARNING_CATEGORY_ORDER = \[[^\]]*\];/),
    extract(/function hasOwn\(obj, key\) \{[\s\S]*?\n\}/),
    extract(/function groupStructuredWarnings\(list\) \{[\s\S]*?\n\}/),
    "return groupStructuredWarnings;",
  ].join("\n");
  return new Function(source)() as (warnings: StructuredLike[]) => Record<string, string[]>;
}

/**
 * Runs the real `executeAll2Html()` from `exporter.jsx` with `runExporter()`
 * stubbed to throw, so the automated *error* envelope is the actual shipped code
 * path rather than a description of it. The error path is where the plain
 * `string[]` accumulator leaked out under a key the panel types as
 * `GroupedWarnings`, and nothing else in the repo type-checks or exercises it.
 */
function loadErrorPath(): (list: StructuredLike[], message: string) => Record<string, unknown> {
  const source = [
    "var warnings = [];",
    "var structuredWarnings = [];",
    "var ALL2HTML_AUTOMATED = true;",
    "var docToMarkSaved = null;",
    "var thrown = null;",
    "var restoreCalls = 0;",
    "function runRestoreActions() { restoreCalls++; }",
    "function log() {}",
    "function logDiagnostic() {}",
    "function alert() { throw new Error('alert() must not run in automated mode'); }",
    "function runExporter() { throw thrown; }",
    extract(/var WARNING_CATEGORY_ORDER = \[[^\]]*\];/),
    extract(/function hasOwn\(obj, key\) \{[\s\S]*?\n\}/),
    extract(/function groupStructuredWarnings\(list\) \{[\s\S]*?\n\}/),
    extract(/function executeAll2Html\(\) \{[\s\S]*?\n\}/),
    "return function (list, message) {",
    "  structuredWarnings = list;",
    "  warnings = [];",
    "  for (var i = 0; i < list.length; i++) warnings.push(list[i].message);",
    "  thrown = { name: 'UserError', message: message };",
    "  var out = JSON.parse(executeAll2Html());",
    "  out.__restoreCalls = restoreCalls;",
    "  return out;",
    "};",
  ].join("\n");
  return new Function(source)() as (
    list: StructuredLike[],
    message: string,
  ) => Record<string, unknown>;
}

/** Exactly what `RunOutputSection.svelte` computes from `result.warnings`. */
function panelWarningCount(warnings: unknown): number {
  return Object.values(warnings as Record<string, string[]>).reduce(
    (sum, items) => sum + items.length,
    0,
  );
}

describe("Illustrator exporter warning plumbing", () => {
  it("groups by the declared category, including the core's capitalized Setting messages", () => {
    // The regression: the core emits category "setting" with a message that
    // starts with a capitalized `Setting "..."`, and the old classifier
    // substring-matched lowercase "setting", so every capability warning on the
    // highest-value surface was filed under `other`.
    const settingWarning = checkSurfaceCapabilities(
      illustratorCapabilities,
      { ...createDefaultSettings(), output: "multiple-files" },
      { surface: "illustrator", path: "render", format: "html" },
    )[0];
    expect(settingWarning.category).toBe("setting");
    expect(settingWarning.message.startsWith('Setting "')).toBe(true);

    const groups = loadGrouper()([
      settingWarning,
      { code: "text:overset", category: "text", message: "Overset text detected." },
      { code: "made:up", category: "not-a-category", message: "Unknown category." },
    ]);

    expect(groups.setting).toEqual([settingWarning.message]);
    expect(groups.text).toEqual(["Overset text detected."]);
    expect(groups.other).toEqual(["Unknown category."]);
  });

  it("uses the same category vocabulary as the core", () => {
    const declared = extract(/var WARNING_CATEGORY_ORDER = \[[^\]]*\];/);
    for (const category of WARNING_CATEGORY_ORDER) {
      expect(declared, `exporter is missing the ${category} category`).toContain(`"${category}"`);
    }
  });

  it("assigns a code and a category at every warn() call site", () => {
    const calls = exporterSource.match(/\bwarn\(/g) ?? [];
    // The definition, plus one call per site.
    expect(calls.length).toBeGreaterThan(15);
    // Every call site ends with two string literal arguments.
    const withoutCodes = exporterSource
      .split("\n")
      .filter((line) => /(^|[^.\w])warn\(/.test(line))
      .filter((line) => !line.includes("function warn("))
      .filter((line) => !/, "[a-z-]+:[a-z-]+", "[a-z]+"\);/.test(line));
    expect(withoutCodes).toEqual([]);
  });

  it("returns grouped warnings when the export throws, not the raw string array", () => {
    // The failing input from the review: one 48-character warning, then a throw.
    const overset = "Overset text detected in artboard 'main' (x2).";
    expect(overset.length).toBeGreaterThan(40);

    const result = loadErrorPath()(
      [{ code: "text:overset", category: "text", message: overset }],
      "output:folder-failed: could not create the output folder",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("output:folder-failed");
    // State restoration still happens on the error path.
    expect(result.__restoreCalls).toBe(1);

    // The shape the panel declares: an object keyed by category, values arrays.
    const grouped = result.warnings as Record<string, unknown>;
    expect(Array.isArray(grouped)).toBe(false);
    expect(typeof grouped).toBe("object");
    for (const category of WARNING_CATEGORY_ORDER) {
      expect(Array.isArray(grouped[category])).toBe(true);
    }
    expect(grouped.text).toEqual([overset]);

    // The regression, stated as the panel states it: one warning, not 48.
    expect(panelWarningCount(grouped)).toBe(1);

    // The structured list rides along unchanged, as on the success path.
    expect(result.structuredWarnings).toEqual([
      { code: "text:overset", category: "text", message: overset },
    ]);
  });

  it("uses one warning envelope for both the success and the error path", () => {
    // Two call sites — the success summary and the automated error return —
    // and both must group. A grep is the only check possible on a file that
    // nothing type-checks.
    const grouped = exporterSource.match(/groupStructuredWarnings\(structuredWarnings\)/g) ?? [];
    expect(grouped.length).toBe(2);
    expect(exporterSource).not.toMatch(/error:\s*errMsg,\s*\n\s*warnings:\s*warnings\b/);
  });

  it("threads the core's structured warnings into the automated response", () => {
    expect(exporterSource).toContain("result.structuredWarnings");
    expect(exporterSource).toContain("groupStructuredWarnings(structuredWarnings)");
    expect(exporterSource).toContain("structuredWarnings: structuredWarnings");
    // The substring classifier is gone, not merely bypassed.
    expect(exporterSource).not.toContain("function groupWarnings(");
    expect(exporterSource).not.toContain('w.indexOf("font")');
  });
});

describe("panel-side grouped warning normalization", () => {
  it("survives the payload the error path used to send", () => {
    const overset = "Overset text detected in artboard 'main' (x2).";
    // The old error-path shape: a bare `string[]`.
    const normalized = normalizeGroupedWarnings([overset]);
    expect(normalized.other).toEqual([overset]);
    expect(panelWarningCount(normalized)).toBe(1);
  });

  it("never turns a string into one warning per character", () => {
    const normalized = normalizeGroupedWarnings("Overset text detected.");
    expect(normalized.other).toEqual(["Overset text detected."]);
    expect(panelWarningCount(normalized)).toBe(1);
  });

  it("passes a well-formed grouped payload through, and files unknown keys under other", () => {
    const normalized = normalizeGroupedWarnings({
      text: ["a"],
      font: ["b", "c"],
      "not-a-category": ["d"],
    });
    expect(normalized.text).toEqual(["a"]);
    expect(normalized.font).toEqual(["b", "c"]);
    expect(normalized.other).toEqual(["d"]);
    expect(panelWarningCount(normalized)).toBe(4);
  });

  it("always returns every category as an array, whatever it was handed", () => {
    for (const payload of [undefined, null, 42, { text: "one string" }, { font: null }]) {
      const normalized = normalizeGroupedWarnings(payload);
      for (const category of WARNING_CATEGORY_ORDER) {
        expect(Array.isArray(normalized[category])).toBe(true);
      }
    }
    expect(normalizeGroupedWarnings({ text: "one string" }).text).toEqual(["one string"]);
    expect(panelWarningCount(normalizeGroupedWarnings(42))).toBe(0);
  });
});
