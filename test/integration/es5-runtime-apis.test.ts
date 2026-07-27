/**
 * Guards every ExtendScript artifact against runtime APIs the host does not have.
 *
 * Transpilers lower syntax but do not polyfill APIs. `Object.hasOwn` compiles
 * cleanly to ES5 and then throws at runtime inside Illustrator/After Effects.
 * The only reliable protection is to scan what actually ships.
 *
 * **The threat model is ES3, not "ES2015+".** This file used to scan for ES2015+
 * APIs only, on the unstated assumption that ES5 was the floor. It is not:
 * ExtendScript is an ES3-era host, so `Array.prototype.every`, `.some`, `.reduce`,
 * `String.prototype.trim` and friends are exactly as absent as `Object.hasOwn`
 * unless `polyfills.ts` installs them. That blind spot shipped a real crash — a
 * bare `.every()` in `compute-positions.ts` that threw on any text element with a
 * `transformMatrix` — and it also caused two reviewers to disagree about whether
 * the bundle was clean, because one of them was scanning with the wrong floor.
 * If you add a check here, ask "does ES3 have this?", not "is this ES2015+?".
 *
 * **Built artifacts are not enough.** Rollup tree-shakes, so a hazard in a module
 * that ships but whose function is currently unreferenced does not appear in
 * `dist/all2html.js` at all. That hid `Number.parseFloat` in
 * `src/emitters/shared/percentage-positions.ts`, reachable the moment a caller
 * passes the documented `positionMode: "percentage"` emitter option. So the
 * ExtendScript-bound *TypeScript* is scanned directly too, walked from the bundle
 * entry point rather than listed by directory (`src/core` and `src/emitters` also
 * hold Node-only modules that never enter this runtime).
 *
 * The allowlist is derived from `src/extendscript/polyfills.ts` rather than
 * hand-maintained, so adding a polyfill automatically unblocks its API — and
 * deleting one automatically re-bans it. The derivation is fail-safe in the
 * direction that matters: a typo in a check's `requires` matches no installed
 * polyfill and therefore *bans* the API everywhere rather than allowing it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureFreshArtifact, repoRoot as root } from "../helpers/extendscript-build.js";
import {
  ARTIFACTS,
  type Artifact,
  EXTENDSCRIPT_SOURCES,
  SOURCE_GROUPS,
} from "../helpers/extendscript-inventory.js";

// ---------------------------------------------------------------------------
// Allowlist, derived from the polyfills that actually ship in the core bundle
// ---------------------------------------------------------------------------

function readInstalledPolyfills(): Set<string> {
  const source = readFileSync(resolve(root, "src/extendscript/polyfills.ts"), "utf-8");
  const installed = new Set<string>();
  const re = /typeof\s+([^=]+?)\s*===\s*"undefined"/g;
  let match = re.exec(source);
  while (match) {
    const expression = match[1]
      .replace(/\s+as\s+any/g, "")
      .replace(/[()]/g, "")
      .trim();
    if (/^[A-Za-z_$][\w$.]*$/.test(expression)) {
      installed.add(expression);
    }
    match = re.exec(source);
  }
  return installed;
}

const INSTALLED_POLYFILLS = readInstalledPolyfills();

// ---------------------------------------------------------------------------
// Source scrubber: drop comments, string literals and regex literals so that a
// mention of `Object.hasOwn` in a comment is not reported as a real call.
//
// Template literals are *not* opaque: the quoted chunks are string content, but
// every `${...}` region is real code and is scanned recursively (including
// nested templates), so a violation cannot hide inside an interpolation.
// ---------------------------------------------------------------------------

const REGEX_CAN_FOLLOW = new Set("(,=:[!&|?{};+-*%~^<>".split(""));
const REGEX_KEYWORD = /\b(return|typeof|case|in|of|new|delete|void|instanceof|do|else)\s*$/;

function scrubLiterals(code: string): string {
  return scrubCode(code, 0, false).out;
}

/**
 * Scrubs code starting at `start`.
 *
 * When `insideInterpolation` is true the scan stops just past the `}` that
 * closes the enclosing `${`, tracking nested braces so object literals and
 * blocks inside the interpolation do not end it early.
 */
function scrubCode(
  code: string,
  start: number,
  insideInterpolation: boolean,
): { out: string; end: number } {
  let out = "";
  let i = start;
  let previous = "";
  let braceDepth = 0;

  while (i < code.length) {
    const char = code[i];
    const next = code[i + 1];

    if (char === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    if (char === '"' || char === "'") {
      i++;
      while (i < code.length) {
        if (code[i] === "\\") {
          i += 2;
          continue;
        }
        if (code[i] === char) {
          i++;
          break;
        }
        i++;
      }
      out += '""';
      previous = ")";
      continue;
    }

    if (char === "`") {
      const template = scrubTemplate(code, i);
      out += template.out;
      i = template.end;
      previous = ")";
      continue;
    }

    if (insideInterpolation && char === "}") {
      if (braceDepth === 0) {
        i++;
        break;
      }
      braceDepth--;
      out += char;
      previous = char;
      i++;
      continue;
    }

    if (insideInterpolation && char === "{") {
      braceDepth++;
    }

    if (
      char === "/" &&
      (previous === "" || REGEX_CAN_FOLLOW.has(previous) || REGEX_KEYWORD.test(out))
    ) {
      i++;
      let inClass = false;
      while (i < code.length) {
        const ch = code[i];
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === "\n") break;
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) {
          i++;
          break;
        }
        i++;
      }
      while (i < code.length && /[a-z]/.test(code[i])) i++;
      out += "/RE/";
      previous = ")";
      continue;
    }

    out += char;
    if (!/\s/.test(char)) previous = char;
    i++;
  }

  return { out, end: i };
}

/**
 * Scrubs a template literal starting at its opening backtick. Quoted chunks
 * collapse to `""`; interpolations are emitted as concatenated code so the
 * scanners see them. Newlines are preserved so reported line numbers hold.
 */
function scrubTemplate(code: string, start: number): { out: string; end: number } {
  let out = '""';
  let i = start + 1;

  while (i < code.length) {
    const char = code[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === "`") {
      i++;
      break;
    }
    if (char === "$" && code[i + 1] === "{") {
      const inner = scrubCode(code, i + 2, true);
      out += `+(${inner.out})+""`;
      i = inner.end;
      continue;
    }
    if (char === "\n") out += "\n";
    i++;
  }

  return { out, end: i };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

interface ApiCheck {
  label: string;
  pattern: RegExp;
  /** Polyfill keys (from polyfills.ts) that make this API safe. */
  requires: string[];
}

/**
 * Member/static APIs that do not exist in ExtendScript's ES3 runtime.
 *
 * Both ES5-era and ES2015+-era entries live here; the runtime draws no distinction
 * between them. `requires` names polyfill keys, and `INSTALLED_POLYFILLS` decides
 * whether the API is actually available — a check whose `requires` is unsatisfied
 * bans the API everywhere, including in artifacts that install the polyfills.
 *
 * Deliberately absent: `.indexOf()` and `.lastIndexOf()`. `String.prototype` has had
 * both since ES3, and member syntax alone cannot tell a string receiver from an array
 * one, so a check would be a false positive on every string search in the unpolyfilled
 * exporters (all 15 current uses across the AE exporter and the panel hostscript are
 * string receivers). `Array.prototype.indexOf` is polyfilled anyway, which covers the
 * artifacts that load the core bundle.
 */
const RUNTIME_API_CHECKS: ApiCheck[] = [
  // Map/Set are never polyfilled. `extendscript-bundle.test.ts` guards the core
  // bundle for these too; this extends the same rule to every artifact.
  { label: "new Map()/new Set()", pattern: /\bnew\s+(?:Map|Set)\s*\(/, requires: [] },
  { label: "Object.hasOwn()", pattern: /\bObject\.hasOwn\s*\(/, requires: ["Object.hasOwn"] },
  { label: "Object.assign()", pattern: /\bObject\.assign\s*\(/, requires: ["Object.assign"] },
  { label: "Object.entries()", pattern: /\bObject\.entries\s*\(/, requires: ["Object.entries"] },
  { label: "Object.values()", pattern: /\bObject\.values\s*\(/, requires: ["Object.values"] },
  { label: "Object.keys()", pattern: /\bObject\.keys\s*\(/, requires: ["Object.keys"] },
  {
    label: "Object.fromEntries()",
    pattern: /\bObject\.fromEntries\s*\(/,
    requires: ["Object.fromEntries"],
  },
  { label: "Array.from()", pattern: /\bArray\.from\s*\(/, requires: ["Array.from"] },
  { label: "Array.of()", pattern: /\bArray\.of\s*\(/, requires: ["Array.of"] },
  { label: "Array.isArray()", pattern: /\bArray\.isArray\s*\(/, requires: ["Array.isArray"] },
  {
    label: ".includes()",
    pattern: /\.includes\s*\(/,
    requires: ["Array.prototype.includes", "String.prototype.includes"],
  },
  { label: ".padStart()", pattern: /\.padStart\s*\(/, requires: ["String.prototype.padStart"] },
  { label: ".padEnd()", pattern: /\.padEnd\s*\(/, requires: ["String.prototype.padEnd"] },
  { label: ".trimStart()", pattern: /\.trimStart\s*\(/, requires: ["String.prototype.trimStart"] },
  { label: ".trimEnd()", pattern: /\.trimEnd\s*\(/, requires: ["String.prototype.trimEnd"] },
  { label: ".repeat()", pattern: /\.repeat\s*\(/, requires: ["String.prototype.repeat"] },
  {
    label: ".startsWith()",
    pattern: /\.startsWith\s*\(/,
    requires: ["String.prototype.startsWith"],
  },
  { label: ".endsWith()", pattern: /\.endsWith\s*\(/, requires: ["String.prototype.endsWith"] },
  { label: ".findIndex()", pattern: /\.findIndex\s*\(/, requires: ["Array.prototype.findIndex"] },
  { label: ".find()", pattern: /\.find\s*\(/, requires: ["Array.prototype.find"] },
  { label: ".flat()", pattern: /\.flat\s*\(/, requires: ["Array.prototype.flat"] },
  { label: ".flatMap()", pattern: /\.flatMap\s*\(/, requires: ["Array.prototype.flatMap"] },
  { label: ".at()", pattern: /\.at\s*\(/, requires: ["Array.prototype.at", "String.prototype.at"] },
  // --- ES5-era array iteration. ES3 has none of these. ---
  { label: ".every()", pattern: /\.every\s*\(/, requires: ["Array.prototype.every"] },
  { label: ".some()", pattern: /\.some\s*\(/, requires: ["Array.prototype.some"] },
  { label: ".forEach()", pattern: /\.forEach\s*\(/, requires: ["Array.prototype.forEach"] },
  { label: ".map()", pattern: /\.map\s*\(/, requires: ["Array.prototype.map"] },
  { label: ".filter()", pattern: /\.filter\s*\(/, requires: ["Array.prototype.filter"] },
  { label: ".reduce()", pattern: /\.reduce\s*\(/, requires: ["Array.prototype.reduce"] },
  {
    label: ".reduceRight()",
    pattern: /\.reduceRight\s*\(/,
    requires: ["Array.prototype.reduceRight"],
  },
  // --- Other ES5-era additions. ---
  { label: ".trim()", pattern: /\.trim\s*\(/, requires: ["String.prototype.trim"] },
  { label: "Date.now()", pattern: /\bDate\.now\s*\(/, requires: ["Date.now"] },
  { label: "Object.create()", pattern: /\bObject\.create\s*\(/, requires: ["Object.create"] },
  {
    label: "Object.getPrototypeOf()",
    pattern: /\bObject\.getPrototypeOf\s*\(/,
    requires: ["Object.getPrototypeOf"],
  },
  {
    label: "Object.defineProperty()",
    pattern: /\bObject\.defineProperty\s*\(/,
    requires: ["Object.defineProperty"],
  },
  { label: "Object.freeze()", pattern: /\bObject\.freeze\s*\(/, requires: ["Object.freeze"] },
  { label: "Number.isNaN()", pattern: /\bNumber\.isNaN\s*\(/, requires: ["Number.isNaN"] },
  {
    label: "Number.isInteger()",
    pattern: /\bNumber\.isInteger\s*\(/,
    requires: ["Number.isInteger"],
  },
  {
    label: "Number.isFinite()",
    pattern: /\bNumber\.isFinite\s*\(/,
    requires: ["Number.isFinite"],
  },
  // The `Number` namespace forms of the ES3 globals. `parseFloat(x)` is fine;
  // `Number.parseFloat(x)` is ES2015 and throws. They are one lint autofix apart
  // (`style/useNumberNamespace`), which is how `percentage-positions.ts` acquired
  // `Number.parseFloat` — it survived only because rollup happened to tree-shake
  // the module that reached it. Same failure family as D22.
  {
    label: "Number.parseFloat()",
    pattern: /\bNumber\.parseFloat\s*\(/,
    requires: ["Number.parseFloat"],
  },
  {
    label: "Number.parseInt()",
    pattern: /\bNumber\.parseInt\s*\(/,
    requires: ["Number.parseInt"],
  },
  // --- Remaining ES5-era statics/methods ES3 does not have. ---
  {
    label: "Object.getOwnPropertyNames()",
    pattern: /\bObject\.getOwnPropertyNames\s*\(/,
    requires: ["Object.getOwnPropertyNames"],
  },
  {
    label: "Object.getOwnPropertyDescriptor()",
    pattern: /\bObject\.getOwnPropertyDescriptor\s*\(/,
    requires: ["Object.getOwnPropertyDescriptor"],
  },
  { label: "Object.seal()", pattern: /\bObject\.seal\s*\(/, requires: ["Object.seal"] },
  {
    label: "Object.preventExtensions()",
    pattern: /\bObject\.preventExtensions\s*\(/,
    requires: ["Object.preventExtensions"],
  },
  {
    label: "Object.setPrototypeOf()",
    pattern: /\bObject\.setPrototypeOf\s*\(/,
    requires: ["Object.setPrototypeOf"],
  },
  // ES5. The transpiler emits it for arrow-function `this` capture in some
  // configurations, so it is worth having a name for when it appears.
  { label: ".bind()", pattern: /\.bind\s*\(/, requires: ["Function.prototype.bind"] },
  {
    label: ".toISOString()",
    pattern: /\.toISOString\s*\(/,
    requires: ["Date.prototype.toISOString"],
  },
  { label: ".fill()", pattern: /\.fill\s*\(/, requires: ["Array.prototype.fill"] },
  // --- ES2015+ leftovers. ---
  {
    label: ".replaceAll()",
    pattern: /\.replaceAll\s*\(/,
    requires: ["String.prototype.replaceAll"],
  },
  { label: ".matchAll()", pattern: /\.matchAll\s*\(/, requires: ["String.prototype.matchAll"] },
  {
    label: ".codePointAt()",
    pattern: /\.codePointAt\s*\(/,
    requires: ["String.prototype.codePointAt"],
  },
  { label: "Math.trunc()", pattern: /\bMath\.trunc\s*\(/, requires: ["Math.trunc"] },
  { label: "Math.sign()", pattern: /\bMath\.sign\s*\(/, requires: ["Math.sign"] },
  { label: "Math.hypot()", pattern: /\bMath\.hypot\s*\(/, requires: ["Math.hypot"] },
  { label: "Math.log2()", pattern: /\bMath\.log2\s*\(/, requires: ["Math.log2"] },
  { label: "Math.log10()", pattern: /\bMath\.log10\s*\(/, requires: ["Math.log10"] },
  { label: "Math.cbrt()", pattern: /\bMath\.cbrt\s*\(/, requires: ["Math.cbrt"] },
  { label: "String.raw", pattern: /\bString\.raw\b/, requires: ["String.raw"] },
];

/** Globals that simply do not exist. `typeof X` feature detection is allowed. */
const BANNED_GLOBALS = [
  "Promise",
  "Symbol",
  "WeakMap",
  "WeakSet",
  "Proxy",
  "Reflect",
  // ES2020. ExtendScript's global object is `$.global`; bundlers reach for
  // `globalThis` in UMD/global-detection preludes, and it throws on reference.
  "globalThis",
];

/** Syntax that must have been lowered by the transpiler. */
const BANNED_SYNTAX: { label: string; pattern: RegExp }[] = [
  { label: "optional chaining (?.)", pattern: /\?\.[^\d]/ },
  { label: "nullish coalescing (??)", pattern: /\?\?/ },
];

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split("\n").length;
}

function findApiViolations(code: string, polyfilled: boolean): string[] {
  const scrubbed = scrubLiterals(code);
  const violations: string[] = [];

  for (const check of RUNTIME_API_CHECKS) {
    const allowed = polyfilled && check.requires.some((key) => INSTALLED_POLYFILLS.has(key));
    if (allowed) continue;
    const match = new RegExp(check.pattern.source, "g").exec(scrubbed);
    if (match) {
      violations.push(`${check.label} (line ~${lineOf(scrubbed, match.index)})`);
    }
  }

  for (const name of BANNED_GLOBALS) {
    const re = new RegExp(`\\b${name}\\b`, "g");
    let match = re.exec(scrubbed);
    while (match) {
      const lineStart = scrubbed.lastIndexOf("\n", match.index) + 1;
      let lineEnd = scrubbed.indexOf("\n", match.index);
      if (lineEnd === -1) lineEnd = scrubbed.length;
      const line = scrubbed.slice(lineStart, lineEnd);
      // `typeof X` guards are how transpiler helpers feature-detect; they are
      // safe in ExtendScript because the guard evaluates to "undefined".
      if (!line.includes(`typeof ${name}`)) {
        violations.push(`${name} (line ~${lineOf(scrubbed, match.index)})`);
        break;
      }
      match = re.exec(scrubbed);
    }
  }

  return violations;
}

function findSyntaxViolations(code: string): string[] {
  const scrubbed = scrubLiterals(code);
  const violations: string[] = [];
  for (const check of BANNED_SYNTAX) {
    const match = new RegExp(check.pattern.source, "g").exec(scrubbed);
    if (match) {
      violations.push(`${check.label} (line ~${lineOf(scrubbed, match.index)})`);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Targets
//
// The artifact list and the ExtendScript-bound source graph live in
// `test/helpers/extendscript-inventory.ts`, because the reserved-word guard in
// `extendscript-reserved-words.test.ts` has to scan the same set and a guard is
// only as wide as its file list.
// ---------------------------------------------------------------------------

/**
 * Reads an artifact, rebuilding it first when it is missing *or stale*. A
 * leftover artifact from an earlier build would otherwise pass this guard while
 * the current sources contain a violation.
 */
function ensureArtifact(artifact: Artifact): string {
  return readFileSync(ensureFreshArtifact(artifact.path, artifact.build), "utf-8");
}

// ---------------------------------------------------------------------------

describe("ES5 runtime API guard", () => {
  // Hoisted so no individual case is charged for a cold `build:panel` (which
  // `pnpm test` does not run first) or for waiting on a parallel worker that
  // holds the build lock. Both blow past vitest's 5 s default timeout.
  beforeAll(() => {
    for (const artifact of ARTIFACTS) ensureFreshArtifact(artifact.path, artifact.build);
  }, 600_000);

  it("derives its allowlist from the shipped polyfills", () => {
    expect(INSTALLED_POLYFILLS.size).toBeGreaterThan(10);
    expect(INSTALLED_POLYFILLS).toContain("Object.keys");
    expect(INSTALLED_POLYFILLS).toContain("Array.prototype.includes");
    // Never polyfilled — these must stay banned everywhere.
    expect(INSTALLED_POLYFILLS).not.toContain("Object.hasOwn");
    expect(INSTALLED_POLYFILLS).not.toContain("Object.fromEntries");
    expect(INSTALLED_POLYFILLS).not.toContain("Array.from");
    // ES5-era, and equally absent from ES3. These are the ones the old
    // "ES2015+" framing let through.
    expect(INSTALLED_POLYFILLS).not.toContain("Array.prototype.every");
    expect(INSTALLED_POLYFILLS).not.toContain("Array.prototype.some");
    expect(INSTALLED_POLYFILLS).not.toContain("Array.prototype.reduce");
    // ...while these are installed, so their APIs are legal in polyfilled artifacts.
    expect(INSTALLED_POLYFILLS).toContain("Array.prototype.map");
    expect(INSTALLED_POLYFILLS).toContain("String.prototype.trim");
  });

  it("every check names a polyfill key that could plausibly exist", () => {
    // Guards against a typo silently disarming a check: `requires: ["Array.every"]`
    // would never match an installed polyfill, which is safe, but the reverse typo
    // in polyfills.ts would be caught by the membership assertions above.
    for (const check of RUNTIME_API_CHECKS) {
      for (const key of check.requires) {
        expect(key).toMatch(/^(?:[A-Z]\w*)(?:\.prototype)?\.\w+$/);
      }
    }
  });

  it("catches unpolyfilled ES5 array methods (regression: compute-positions .every)", () => {
    // The exact shape that shipped a TypeError into Illustrator. `polyfilled: true`
    // is the strongest case — even the artifact that installs every polyfill we have
    // must reject it, because `every` is not among them.
    const planted = "return m.length === 6 && m.every(function (v, i) { return v === I[i]; });";
    expect(findApiViolations(planted, true)).toEqual([".every() (line ~1)"]);
    expect(findApiViolations(planted, false)).toEqual([".every() (line ~1)"]);

    // Siblings from the same family.
    expect(findApiViolations("a.some(f);", true)).toHaveLength(1);
    expect(findApiViolations("a.reduce(f, 0);", true)).toHaveLength(1);
    expect(findApiViolations("a.reduceRight(f, 0);", true)).toHaveLength(1);
    expect(findApiViolations("var t = Date.now();", true)).toHaveLength(1);

    // ...and the polyfilled ones stay legal where the polyfills run, banned where
    // they do not. This is the derived-allowlist behavior, asserted rather than assumed.
    expect(findApiViolations("a.map(f);", true)).toHaveLength(0);
    expect(findApiViolations("a.map(f);", false)).toHaveLength(1);
    expect(findApiViolations("s.trim();", true)).toHaveLength(0);
    expect(findApiViolations("s.trim();", false)).toHaveLength(1);
  });

  it("scans the ExtendScript-bound TypeScript, not just the tree-shaken artifact", () => {
    const relative = EXTENDSCRIPT_SOURCES.map((file) => file.slice(root.length + 1));
    // The three trees the old artifact-only scan could not see through.
    expect(relative.some((f) => f.startsWith("src/core/"))).toBe(true);
    expect(relative.some((f) => f.startsWith("src/emitters/"))).toBe(true);
    expect(relative.some((f) => f.startsWith("src/ir/"))).toBe(true);
    // The specific module whose `Number.parseFloat` rollup dropped: reachable
    // from the entry point through `shared/options.ts`, absent from the bundle
    // until `positionMode: "percentage"` is set.
    expect(relative).toContain("src/emitters/shared/percentage-positions.ts");
    expect(relative).toContain("src/emitters/shared/options.ts");
    expect(relative.length).toBeGreaterThan(15);
  });

  it("catches the Number namespace forms of the ES3 globals", () => {
    // `parseFloat` is ES3 and legal; `Number.parseFloat` is ES2015 and throws.
    // One `style/useNumberNamespace` autofix apart.
    expect(findApiViolations("var n = parseFloat(s);", true)).toEqual([]);
    expect(findApiViolations("var n = Number.parseFloat(s);", true)).toEqual([
      "Number.parseFloat() (line ~1)",
    ]);
    expect(findApiViolations("var n = Number.parseInt(s, 10);", true)).toHaveLength(1);
    expect(findApiViolations("if (Number.isFinite(n)) {}", true)).toHaveLength(1);
    expect(findApiViolations("var g = globalThis;", true)).toHaveLength(1);
    expect(findApiViolations("var f = fn.bind(this);", true)).toHaveLength(1);
    expect(findApiViolations('var s = "".replaceAll("a", "b");', true)).toHaveLength(1);
    expect(findApiViolations("var t = Math.trunc(n);", true)).toHaveLength(1);
    expect(findApiViolations("var o = Object.getOwnPropertyNames(x);", true)).toHaveLength(1);
  });

  it("ignores comments, strings and regex literals", () => {
    expect(scrubLiterals("// Object.hasOwn(x, y)\nvar a = 1;")).not.toContain("Object.hasOwn");
    expect(scrubLiterals("/* Object.hasOwn */ var a = 1;")).not.toContain("Object.hasOwn");
    expect(scrubLiterals('var a = "Object.hasOwn(x)";')).not.toContain("Object.hasOwn");
    // A regex containing quotes must not swallow the following code.
    expect(scrubLiterals('s.replace(/"/g, "&quot;"); Object.hasOwn(a, b);')).toContain(
      "Object.hasOwn",
    );
    // A URL inside a string must not be treated as a line comment.
    expect(scrubLiterals('var u = "https://x/y"; Object.hasOwn(a, b);')).toContain("Object.hasOwn");
  });

  // biome-ignore-start lint/suspicious/noTemplateCurlyInString: these strings
  // are ExtendScript source samples; the `${...}` is the thing under test.
  it("scans template literal interpolations", () => {
    // The literal chunks of a template are still string content...
    expect(scrubLiterals("var s = `Object.hasOwn(x, y)`;")).not.toContain("Object.hasOwn");
    // ...but `${...}` regions are real code and must stay visible.
    expect(scrubLiterals("var s = `id=${Object.hasOwn(a, b)}`;")).toContain("Object.hasOwn");
    // Nested templates inside an interpolation.
    expect(scrubLiterals("var s = `a${`b${Object.hasOwn(a, b)}c`}d`;")).toContain("Object.hasOwn");
    // Braces inside an interpolation must not end it early.
    expect(scrubLiterals("var s = `${f({ k: 1 })}` + Object.hasOwn(a, b);")).toContain(
      "Object.hasOwn",
    );
    // A backtick inside a quoted string must not open a template.
    expect(scrubLiterals('var s = "`${"; Object.hasOwn(a, b);')).toContain("Object.hasOwn");
  });

  it("detects a planted violation", () => {
    expect(findApiViolations("var ok = Object.hasOwn(a, b);", true)).toHaveLength(1);
    expect(findApiViolations("var s = `id=${Object.hasOwn(a, b)}`;", true)).toHaveLength(1);
    expect(findApiViolations("var s = `a${`b${new Promise(r)}c`}d`;", true)).toHaveLength(1);
    expect(findSyntaxViolations("var s = `${a?.b}`;")).toHaveLength(1);
    expect(findApiViolations("var p = new Promise(function () {});", true)).toHaveLength(1);
    expect(
      findApiViolations('var t = typeof Symbol === "function" ? Symbol : null;', true),
    ).toHaveLength(0);
    expect(findSyntaxViolations("var v = a?.b;")).toHaveLength(1);
    expect(findSyntaxViolations("var v = a ?? b;")).toHaveLength(1);
    expect(findSyntaxViolations("var v = a ? .5 : 1;")).toHaveLength(0);
  });
  // biome-ignore-end lint/suspicious/noTemplateCurlyInString: end of samples

  /**
   * `ensureArtifact` may shell out to a full build. `build:panel` alone takes well
   * over vitest's 5 s default, so whichever test happens to be first for a stale
   * artifact would fail on a timeout rather than on a finding — a flaky gate that
   * reads like a real violation. The build runs at most once per process, so this
   * budget applies to one test per artifact in practice.
   */
  const BUILD_TIMEOUT_MS = 180_000;

  for (const artifact of ARTIFACTS) {
    it(
      `${artifact.label} uses no ES5-incompatible runtime API`,
      () => {
        const code = ensureArtifact(artifact);
        expect(findApiViolations(code, artifact.polyfilled)).toEqual([]);
      },
      BUILD_TIMEOUT_MS,
    );

    it(
      `${artifact.label} contains no untranspiled modern syntax`,
      () => {
        const code = ensureArtifact(artifact);
        expect(findSyntaxViolations(code)).toEqual([]);
      },
      BUILD_TIMEOUT_MS,
    );

    it(
      `${artifact.label} ships json2 if it uses JSON`,
      () => {
        if (artifact.jsonFromHost) return;
        const code = ensureArtifact(artifact);
        if (!/\bJSON\s*\.\s*(?:parse|stringify)\s*\(/.test(scrubLiterals(code))) return;
        // json2 assigns onto the object it creates; either marker means the
        // implementation is present rather than merely referenced.
        expect(code).toMatch(/JSON\.stringify\s*=\s*function|\bjson2\b/);
      },
      BUILD_TIMEOUT_MS,
    );
  }

  for (const group of SOURCE_GROUPS) {
    it(`${group.label} use no ES5-incompatible runtime API`, () => {
      expect(group.files.length).toBeGreaterThan(0);
      const offenders: Record<string, string[]> = {};
      for (const file of group.files) {
        const violations = findApiViolations(readFileSync(file, "utf-8"), group.polyfilled);
        if (violations.length > 0) {
          offenders[file.slice(root.length + 1)] = violations;
        }
      }
      expect(offenders).toEqual({});
    });
  }
});
