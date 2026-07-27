/**
 * ExtendScript's regex engine lacks V8's backtracking optimizations: a pattern
 * that is imperceptible in Node can hang Illustrator outright. A font-family
 * validator of this shape took >300s per call there and ~56us in Node, so the
 * whole suite passed while every export using a mapped font hung.
 *
 * The check is on shape, not runtime — a quantifier applied to a group that
 * itself contains one, the classic `(a+)*`. Timing in Node would prove nothing;
 * Node is the engine that hides the bug.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ensureFreshArtifact } from "../helpers/extendscript-build.js";

/**
 * True when a quantifier is applied to a group whose body also contains a
 * quantifier. Character classes are skipped — `[+*]` is literal inside one.
 */
function hasNestedQuantifier(source: string): boolean {
  const groupHasQuantifier: boolean[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") {
      i++;
      while (i < source.length && source.charAt(i) !== "]") {
        if (source.charAt(i) === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === "(") {
      groupHasQuantifier.push(false);
      i++;
      continue;
    }
    if (ch === ")") {
      const innerQuantified = groupHasQuantifier.pop() ?? false;
      const next = source.charAt(i + 1);
      const quantified =
        next === "*" ||
        next === "+" ||
        next === "{" ||
        (next === "?" && (source.charAt(i + 2) === "*" || source.charAt(i + 2) === "+"));
      if (quantified && innerQuantified) return true;
      // A quantified group is itself a quantifier as far as its parent cares.
      if (quantified && groupHasQuantifier.length > 0) {
        groupHasQuantifier[groupHasQuantifier.length - 1] = true;
      }
      i++;
      continue;
    }
    if (ch === "*" || ch === "+" || ch === "{") {
      if (groupHasQuantifier.length > 0) {
        groupHasQuantifier[groupHasQuantifier.length - 1] = true;
      }
    }
    i++;
  }
  return false;
}

/** Regex literals appearing in JS source. Conservative by design. */
function extractRegexLiterals(code: string): string[] {
  const found: string[] = [];
  const pattern =
    /(?:^|[=(,:!&|?{};[\n]\s*)\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/[dgimsuvy]*/g;
  let match = pattern.exec(code);
  while (match !== null) {
    found.push(match[1]);
    match = pattern.exec(code);
  }
  return found;
}

/** String literals passed straight to `new RegExp(...)`. */
function extractRegExpConstructorArgs(code: string): string[] {
  const found: string[] = [];
  const pattern = /new RegExp\(\s*"((?:[^"\\]|\\.)*)"/g;
  let match = pattern.exec(code);
  while (match !== null) {
    // Un-escape the JS string layer so the regex source is what we inspect.
    found.push(match[1].replace(/\\"/g, '"'));
    match = pattern.exec(code);
  }
  return found;
}

/** Known instances, each with the reason ExtendScript survives it. */
const ALLOWED: Record<string, string> = {
  "(?:^|:|,)(?:\\s*\\[)+": "json2.js JSON.parse guard; runs only over small tool-authored config",
};

const ARTIFACTS = [
  { path: "dist/extendscript/all2html-core.js", build: "build:extendscript" },
  { path: "dist/all2html.js", build: "build:illustrator" },
];

describe("ExtendScript regex safety", () => {
  it("flags the pattern that actually hung Illustrator", () => {
    const quoted = "\"[^\"'<>\\\\\\r\\n]*\"|'[^\"'<>\\\\\\r\\n]*'";
    const ident =
      "-?[_a-zA-Z\\u00A0-\\uFFFF][\\w\\u00A0-\\uFFFF-]*(?:[ \\t]+[\\w\\u00A0-\\uFFFF][\\w\\u00A0-\\uFFFF-]*)*";
    const family = `(?:${quoted}|${ident})`;
    expect(hasNestedQuantifier(`^[ \\t]*${family}(?:[ \\t]*,[ \\t]*${family})*[ \\t]*$`)).toBe(
      true,
    );
  });

  it("does not flag linear patterns", () => {
    for (const safe of ["^[a-z]+$", "(ab)+", "^[a-zA-Z0-9%. -]*$", "\\s+", "[+*]+"]) {
      expect(hasNestedQuantifier(safe), safe).toBe(false);
    }
  });

  for (const artifact of ARTIFACTS) {
    it(`${artifact.path} contains no nested-quantifier regex`, () => {
      const code = readFileSync(ensureFreshArtifact(artifact.path, artifact.build), "utf8");
      const sources = [...extractRegexLiterals(code), ...extractRegExpConstructorArgs(code)];
      expect(sources.length).toBeGreaterThan(10); // the extractor still works

      const offenders = [...new Set(sources.filter(hasNestedQuantifier))].filter(
        (source) => !(source in ALLOWED),
      );
      expect(
        offenders,
        `Nested-quantifier regex in a shipped ExtendScript artifact. Illustrator's engine ` +
          `backtracks exponentially where V8 does not; rewrite as a linear scan (see ` +
          `isValidCssFontFamily in src/core/compute-styles.ts) or justify it in ALLOWED.`,
      ).toEqual([]);
    });
  }

  /**
   * ExtendScript's tokenizer ends a regex literal at the first unescaped `/`
   * even inside a character class, so /[^/\\]+$/ — legal per the ES spec and
   * accepted by every ES3 *parser* guard in this suite — is a load-time
   * SyntaxError that takes the whole hostscript down with it. Only a literal
   * with `/` inside a class can reach this state (a bare `/` outside a class
   * would have terminated the literal in Node too), so any unescaped `/` in an
   * extracted literal body is a shipped parse failure. `new RegExp("...")` is
   * the fix, never an ALLOWED entry.
   */
  function hasUnescapedSlash(source: string): boolean {
    for (let i = 0; i < source.length; i++) {
      if (source.charAt(i) === "\\") {
        i++;
        continue;
      }
      if (source.charAt(i) === "/") return true;
    }
    return false;
  }

  const EXTENDSCRIPT_SOURCE_GROUPS: Array<{ label: string; files: () => string[] }> = [
    ...ARTIFACTS.map((artifact) => ({
      label: artifact.path,
      files: () => [ensureFreshArtifact(artifact.path, artifact.build)],
    })),
    {
      label: "panel src/jsx",
      files: () => {
        const { globSync } = require("node:fs") as typeof import("node:fs");
        return globSync("plugins/illustrator/panel/src/jsx/**/*.{ts,js}");
      },
    },
    {
      label: "after-effects exporter",
      files: () => ["plugins/after-effects/exporter.jsx"],
    },
  ];

  for (const group of EXTENDSCRIPT_SOURCE_GROUPS) {
    it(`${group.label} contains no regex literal ExtendScript cannot tokenize`, () => {
      for (const file of group.files()) {
        const offenders = extractRegexLiterals(readFileSync(file, "utf8")).filter(
          hasUnescapedSlash,
        );
        expect(
          offenders,
          `${file}: regex literal with unescaped '/' in a character class — ExtendScript ` +
            `ends the literal at the first '/', making the whole file a SyntaxError. ` +
            `Use new RegExp("...") instead.`,
        ).toEqual([]);
      }
    });
  }
});
