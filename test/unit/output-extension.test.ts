import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInsideOutputDir } from "../../src/cli/output-paths.js";
import {
  resolveOutputExtension,
  SAFE_OUTPUT_EXTENSION_RE,
} from "../../src/core/output-extension.js";
import { processDocument } from "../../src/core/pipeline.js";
import type { StructuredWarning } from "../../src/core/warnings.js";
import { getEmitter } from "../../src/emitters/registry.js";
import { processAndEmit } from "../../src/extendscript/index.js";
import type { Document } from "../../src/ir/types.js";

/**
 * `htmlOutputExtension` names a file. It arrives from the `ai2html-settings`
 * text block, `all2html.config.json`, the CEP panel and the Figma plugin's
 * JSONC, so it is attacker-influenced in exactly the way `projectName` was.
 *
 * The old normalization only ensured a leading dot: `/../../outside.txt` became
 * `./../../outside.txt`, and `join(outputDir, slug + extension)` in the CLI —
 * and `writeFile(outputPath + slug + extension)` in `exporter.jsx` — resolved
 * above the directory the user chose.
 */

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

const NUL = String.fromCharCode(0);

/** Everything that is not a filename suffix. */
const REJECTED = [
  "/../../outside.txt",
  "../x",
  "a/b",
  "a\\b",
  "/etc/passwd",
  "C:\\Windows\\system32",
  "..",
  ".",
  "./x",
  ".ht ml",
  ".html;rm -rf",
  ".html" + NUL,
  NUL + ".html",
  ".ht" + NUL + "ml",
  // 26 characters of suffix: a filename component, but not an extension.
  ".averyveryverylongextension",
];

const ACCEPTED: Array<[string, string]> = [
  [".html", ".html"],
  [".php", ".php"],
  [".htm", ".htm"],
  [".HTML", ".HTML"],
  // The leading dot has always been optional; that is the normalization the
  // old helper existed for, and it is kept.
  ["php", ".php"],
  [".html5", ".html5"],
  [".my-ext_1", ".my-ext_1"],
];

function loadDoc(settings?: Partial<Document["settings"]>): Document {
  const doc: Document = JSON.parse(
    readFileSync(resolve(fixturesDir, "single-artboard-basic.json"), "utf-8"),
  );
  if (settings) doc.settings = { ...doc.settings, ...settings };
  return doc;
}

describe("the accepted extension shape", () => {
  it("accepts a dot plus a short run of filename-safe characters", () => {
    for (const [input, expected] of ACCEPTED) {
      const warnings: StructuredWarning[] = [];
      expect(resolveOutputExtension(input, warnings), input).toBe(expected);
      expect(warnings, `${input} warned`).toEqual([]);
    }
  });

  it("rejects separators, traversal, NUL and anything else that is not a suffix", () => {
    for (const value of REJECTED) {
      const warnings: StructuredWarning[] = [];
      expect(resolveOutputExtension(value, warnings), value).toBe(".html");
      expect(warnings, `${value} was accepted silently`).toHaveLength(1);
      expect(warnings[0].code).toBe("setting:invalid-value");
      expect(warnings[0].category).toBe("setting");
      expect(warnings[0].setting).toBe("htmlOutputExtension");
      expect(warnings[0].message).toContain("htmlOutputExtension");
      // The rejected value is named, so the user can see what was ignored.
      expect(warnings[0].message).toContain(value);
    }
  });

  it("treats absent and empty as unset, not as an attack", () => {
    for (const value of [undefined, "", null]) {
      const warnings: StructuredWarning[] = [];
      expect(resolveOutputExtension(value, warnings)).toBe(".html");
      expect(warnings).toEqual([]);
    }
  });

  it("names the surface when the caller knows it", () => {
    const warnings: StructuredWarning[] = [];
    resolveOutputExtension("../x", warnings, "illustrator");
    expect(warnings[0].surface).toBe("illustrator");
  });

  it("uses a pattern ExtendScript can tokenize and cannot hang on", () => {
    // A `/` inside a character class ends the literal in ExtendScript, and a
    // nested quantifier is what hung Illustrator for 300s per call. Both are
    // enforced repo-wide against the built artifact; asserted here at the source
    // so a failure names this pattern.
    expect(SAFE_OUTPUT_EXTENSION_RE.source).not.toContain("/");
    expect(SAFE_OUTPUT_EXTENSION_RE.source.replace(/\[[^\]]*\]/g, "")).not.toMatch(/\)[*+{]/);
  });
});

describe("the html emitter is the one reader, and it rejects at the boundary", () => {
  function emitWith(extension: string) {
    const doc = processDocument(loadDoc({ htmlOutputExtension: extension }), {
      surface: { surface: "cli", path: "render", format: "html" },
    });
    return getEmitter("html").emitAll(doc.document, doc.groups);
  }

  it("carries a legitimate custom extension onto every file", () => {
    const result = emitWith(".php");
    expect(result.files.map((file) => file.extension)).toEqual([".php"]);
    expect(result.structuredWarnings.filter((w) => w.code === "setting:invalid-value")).toEqual([]);
  });

  it("falls back to .html and warns for a traversal value", () => {
    const result = emitWith("/../../outside.txt");
    expect(result.files.map((file) => file.extension)).toEqual([".html"]);
    const warning = result.structuredWarnings.find((w) => w.code === "setting:invalid-value");
    expect(warning?.setting).toBe("htmlOutputExtension");
    // The plain-string projection carries it too — that is what the CLI prints
    // and what the manifest records.
    expect(result.warnings.some((message) => message.includes("htmlOutputExtension"))).toBe(true);
  });

  it("warns once per emit, not once per artboard group", () => {
    const raw = JSON.parse(
      readFileSync(resolve(fixturesDir, "multiple-files-output.json"), "utf-8"),
    );
    const doc = processDocument(
      { ...raw, settings: { output: "multiple-files", htmlOutputExtension: "../x" } },
      { surface: { surface: "cli", path: "render", format: "html" } },
    );
    const result = getEmitter("html").emitAll(doc.document, doc.groups);

    expect(result.files.length).toBeGreaterThan(1);
    expect(
      result.structuredWarnings.filter((w) => w.code === "setting:invalid-value"),
    ).toHaveLength(1);
  });
});

/**
 * The sink-side half. A sanitized extension is the fix; this is the guarantee
 * that holds even if some future producer of a filename forgets — including the
 * one that exists today, `imageOutputPath`, which `createOutputBundle` prefixes
 * onto asset paths with no traversal check of its own.
 */
describe("the CLI cannot resolve a write path outside its output directory", () => {
  const outDir = resolve("/tmp/all2html-out");

  it("refuses traversal, absolute paths and NUL-free look-alikes", () => {
    for (const hostile of [
      "graphic./../../outside.txt",
      "../outside.html",
      "../../../../etc/passwd",
      "/etc/passwd",
      "sub/../../outside.html",
      `..${sep}outside.html`,
    ]) {
      expect(() => resolveInsideOutputDir(outDir, hostile), hostile).toThrow(
        /outside the output directory/,
      );
    }
  });

  it("allows ordinary names and the subdirectories the bundle really uses", () => {
    expect(resolveInsideOutputDir(outDir, "graphic.html")).toBe(join(outDir, "graphic.html"));
    expect(resolveInsideOutputDir(outDir, "all2html-output/img.png")).toBe(
      join(outDir, "all2html-output", "img.png"),
    );
    // A prefix match is not containment: a sibling directory whose name starts
    // with the output directory's name must not pass.
    expect(() => resolveInsideOutputDir(outDir, "../all2html-out-evil/x.html")).toThrow();
  });
});

/**
 * The ExtendScript path has no Zod and no CLI: `exporter.jsx` concatenates
 * `outputPath + slug + extension` at its write site, so the value it receives
 * has to be safe before it gets there. That is why the guard lives in the core
 * bundle rather than in the exporter — the same reasoning as
 * `sanitizeIdentifierSettings`.
 */
describe("the Illustrator path hands the exporter a safe extension", () => {
  it("rejects a traversal extension, warns, and emits .html files", () => {
    const result = processAndEmit(loadDoc({ htmlOutputExtension: "/../../outside.txt" }));

    for (const file of result.files) {
      expect(file.extension).toBe(".html");
      expect(`${file.slug}${file.extension}`).not.toMatch(/[\\/]|\.\./);
    }
    const warning = result.structuredWarnings.find(
      (w) => w.code === "setting:invalid-value" && w.setting === "htmlOutputExtension",
    );
    expect(warning?.surface).toBe("illustrator");
  });

  it("still honors a legitimate .php, which is the setting's whole purpose", () => {
    const result = processAndEmit(loadDoc({ htmlOutputExtension: ".php" }));

    expect(result.files.map((file) => file.extension)).toEqual([".php"]);
    expect(result.structuredWarnings.filter((w) => w.code === "setting:invalid-value")).toEqual([]);
  });

  it("guards the panel/config path too, not only the document text block", () => {
    const result = processAndEmit(loadDoc(), { settings: { htmlOutputExtension: "a/b" } });
    expect(result.files.map((file) => file.extension)).toEqual([".html"]);
    expect(
      result.structuredWarnings.some(
        (w) => w.code === "setting:invalid-value" && w.setting === "htmlOutputExtension",
      ),
    ).toBe(true);
  });
});
