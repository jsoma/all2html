/**
 * Guards every ExtendScript-executed file against binding a word the host
 * reserves.
 *
 * ExtendScript is an ES3-era engine, and ES3 reserves a much larger vocabulary
 * than modern JavaScript does. Using one of those words anywhere an identifier
 * is *bound* — or as an unquoted object-literal key — is a hard parse error, so
 * the file dies on load with "Error 9: Illegal use of reserved word". Node has
 * no such reservation, which is why the whole test suite can be green while
 * Illustrator refuses to run the bundle.
 *
 * **What the real engine does.** The word list and the checked positions are not
 * derived from a spec reading; they were probed by `eval()`ing each candidate in
 * every position inside a live ExtendScript host:
 *
 *   - all 25 ECMA-262 3rd ed. §7.5.2 keywords and all 31 §7.5.3 future reserved
 *     words are rejected as `var` names, function names, parameters, catch
 *     parameters and **unquoted object keys** — 56 words, where this guard used
 *     to list 16;
 *   - `obj.char` and `obj["char"]` are *accepted*, so member access is not
 *     checked and must not be: flagging it would ban `.length`-style property
 *     names that work;
 *   - `{ "class": 1 }` is *accepted*, so quoting is the fix, not renaming;
 *   - trailing commas in object and array literals are *accepted* (the current
 *     bundle ships 59 of them), so this is not a strict-ES3 parse — matching the
 *     engine matters more than matching the grammar.
 *
 * **Why an AST and not a regex.** The previous guard was five regexes over one
 * file, and it could not see: a function *name*, the second and later declarators
 * in a `var` list (83 such statements in the current bundle), a parameter list
 * containing a nested `)`, or an object key. The parameter case is not
 * hypothetical — `escapeAttr` shipped `function (char) {...}`, transpiled from an
 * arrow function, and crashed a live Illustrator run while every Node test
 * passed.
 *
 * **Why every artifact.** The old guard scanned `dist/extendscript/all2html-core.js`
 * alone: not `dist/all2html.js` (the file users install), not either hand-written
 * `exporter.jsx` — which is where the `char` bug actually lived — and none of the
 * panel's `jsx/` bundles. The inventory is shared with the ES5 runtime-API guard
 * (`test/helpers/extendscript-inventory.ts`) so the two cannot drift apart again.
 */
import { readFileSync, statSync } from "node:fs";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureFreshArtifact, repoRoot } from "../helpers/extendscript-build.js";
import {
  ARTIFACTS,
  SOURCE_GROUPS,
  VENDORED_EXTENDSCRIPT,
} from "../helpers/extendscript-inventory.js";

/** ECMA-262 3rd ed. §7.5.2 — Keywords. */
const ES3_KEYWORDS = [
  "break",
  "case",
  "catch",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "finally",
  "for",
  "function",
  "if",
  "in",
  "instanceof",
  "new",
  "return",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
];

/**
 * ECMA-262 3rd ed. §7.5.3 — FutureReservedWord. The Java-flavoured half of this
 * list is what the original 16-word guard covered; the rest (`class`, `const`,
 * `enum`, `export`, `extends`, `implements`, `import`, `interface`, `package`,
 * `private`, `protected`, `public`, `static`, `super`, `debugger`) is exactly as
 * rejected by the engine and was not checked at all.
 */
const ES3_FUTURE_RESERVED = [
  "abstract",
  "boolean",
  "byte",
  "char",
  "class",
  "const",
  "debugger",
  "double",
  "enum",
  "export",
  "extends",
  "final",
  "float",
  "goto",
  "implements",
  "import",
  "int",
  "interface",
  "long",
  "native",
  "package",
  "private",
  "protected",
  "public",
  "short",
  "static",
  "super",
  "synchronized",
  "throws",
  "transient",
  "volatile",
];

/** §7.8 literals. Not keywords, equally illegal as identifiers. */
const ES3_LITERALS = ["null", "true", "false"];

const RESERVED = new Set([...ES3_KEYWORDS, ...ES3_FUTURE_RESERVED, ...ES3_LITERALS]);

interface Violation {
  line: number;
  word: string;
  position: string;
  text: string;
}

function format(file: string, violation: Violation): string {
  return `${file}:${violation.line} — ${violation.position} \`${violation.word}\`: ${violation.text}`;
}

/**
 * Reports every reserved word bound as an identifier, or written as an unquoted
 * object key, in `code`.
 *
 * Type-only positions are skipped: an `interface { char: string }` member or a
 * `(char: string) => void` function type is erased before anything reaches the
 * host, and failing on those would only teach people to rename types.
 */
function scanForReservedWords(file: string, code: string): Violation[] {
  const scriptKind = file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, scriptKind);

  // A file the parser choked on would report zero violations and look clean.
  const parseDiagnostics =
    (source as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    const first = parseDiagnostics[0];
    const line = first.start
      ? source.getLineAndCharacterOfPosition(first.start).line + 1
      : "unknown";
    throw new Error(
      `${file} did not parse (line ${line}): ` +
        `${ts.flattenDiagnosticMessageText(first.messageText, " ")}. ` +
        "The reserved-word scan cannot see inside a file it cannot parse.",
    );
  }

  const violations: Violation[] = [];
  const record = (name: ts.Node | undefined, container: ts.Node, position: string): void => {
    if (!name || !ts.isIdentifier(name) || !RESERVED.has(name.text)) return;
    violations.push({
      line: source.getLineAndCharacterOfPosition(name.getStart(source)).line + 1,
      word: name.text,
      position,
      text: container.getText(source).split("\n")[0].slice(0, 100),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isTypeNode(node)) {
      return;
    }

    if (ts.isVariableDeclaration(node)) {
      // Every declarator, not just the first: `var a = 1, char = 2;`.
      record(node.name, node, "var declarator");
    } else if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      record(node.name, node, "function name");
    } else if (ts.isParameter(node)) {
      record(node.name, node, "parameter");
    } else if (ts.isBindingElement(node)) {
      // Destructuring lowers to plain bindings with the same names.
      record(node.name, node, "destructured binding");
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      record(node.variableDeclaration.name, node.variableDeclaration, "catch parameter");
    } else if (
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      // Quoted and computed keys are legal in the engine; only bare ones are not.
      record(node.name, node, "unquoted object key");
    } else if (ts.isLabeledStatement(node)) {
      record(node.label, node, "label");
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return violations;
}

function scanFile(path: string): { label: string; violations: Violation[]; bytes: number } {
  const label = path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
  const code = readFileSync(path, "utf-8");
  return { label, violations: scanForReservedWords(label, code), bytes: code.length };
}

describe("ExtendScript reserved words", () => {
  // Building is hoisted out of the individual cases: `build:panel` can take tens
  // of seconds on a cold checkout (it is not run before `pnpm test` in CI), and a
  // parallel worker holding the build lock adds more. Charging that to whichever
  // `it` happened to ask first made them time out at vitest's 5 s default.
  beforeAll(() => {
    for (const artifact of ARTIFACTS) ensureFreshArtifact(artifact.path, artifact.build);
  }, 600_000);

  it("covers the full ES3 reserved vocabulary, not the Java-flavoured subset", () => {
    // 25 keywords + 31 future reserved words = the 56 the live host rejects.
    expect(ES3_KEYWORDS).toHaveLength(25);
    expect(ES3_FUTURE_RESERVED).toHaveLength(31);
    expect(RESERVED.size).toBe(59);

    // The 16 the old guard listed are still in.
    for (const word of ["char", "byte", "int", "long", "short", "float", "double", "boolean"]) {
      expect(RESERVED.has(word)).toBe(true);
    }
    // ...and the ones it missed, including the two `react.ts` uses as object keys.
    for (const word of ["class", "for", "default", "static", "super", "enum", "const"]) {
      expect(RESERVED.has(word)).toBe(true);
    }
    // ES5/ES2015 additions are NOT ES3-reserved; the engine binds them happily,
    // and banning them would be a false positive.
    for (const word of ["let", "yield", "await", "undefined"]) {
      expect(RESERVED.has(word)).toBe(false);
    }
  });

  it("catches every position the old regex guard could not see", () => {
    const hazards: [string, string, string][] = [
      // The exact shape that crashed a live Illustrator run.
      ["parameter", "escapeAttr regression", 'var f = function (char) { return "&#" + char; };'],
      ["parameter", "second parameter", "function f(a, char) { return char; }"],
      ["parameter", "nested paren in the list", "function f(a = g(1), char) { return char; }"],
      ["parameter", "multiline header", "function f(\n  a,\n  char\n) { return char; }"],
      ["parameter", "arrow parameter", "var f = (char) => char;"],
      ["destructured binding", "object destructuring", "function f({ char }) { return char; }"],
      ["destructured binding", "array destructuring", "function f([char]) { return char; }"],
      ["function name", "declaration", "function char(a) { return a; }"],
      ["function name", "expression", "var f = function char(a) { return a; };"],
      ["var declarator", "first declarator", "var char = 1;"],
      ["var declarator", "second declarator", "var a = 1, char = 2;"],
      ["var declarator", "for-in binding", "for (var char in obj) { use(char); }"],
      ["catch parameter", "catch", "try { x(); } catch (char) { y(); }"],
      // `src/emitters/react.ts` ATTR_NAME_MAP, verbatim.
      ["unquoted object key", "future reserved key", 'var m = { class: "className" };'],
      ["unquoted object key", "keyword key", 'var m = { for: "htmlFor" };'],
      ["unquoted object key", "shorthand", "var o = { char };"],
      ["unquoted object key", "getter", "var o = { get char() { return 1; } };"],
      ["label", "labelled loop", "char: for (;;) { break char; }"],
    ];

    for (const [position, name, code] of hazards) {
      const found = scanForReservedWords(`${name}.js`, code);
      expect(
        found.map((v) => v.position),
        `${name}: ${code}`,
      ).toContain(position);
    }
  });

  it("does not flag what the engine actually accepts", () => {
    const legal = [
      // Probed: quoted keys, bracket access and member access all run.
      'var m = { "class": "className", "for": "htmlFor" };',
      "var s = obj.char + obj.class + obj.default;",
      'var s = obj["char"];',
      "obj.float = 1;",
      // Probed: trailing commas are fine. 59 of them ship today.
      "var o = { a: 1, };",
      "var a = [1, 2, ];",
      // Words that merely contain a reserved word.
      "var charCount = 1, classes = [], defaultValue = 2, intern = 3;",
      "var o = { charset: 1, className: 2 };",
      // Computed keys are not identifier positions.
      "var o = {}; o[key] = 1;",
    ];

    for (const code of legal) {
      expect(scanForReservedWords("legal.js", code), code).toEqual([]);
    }
  });

  it("skips type-only positions in TypeScript sources", () => {
    const code = [
      "interface Attrs { char: string; class: string }",
      "type Fn = (char: string) => void;",
      "export function run(value: string): string { return value; }",
    ].join("\n");
    expect(scanForReservedWords("types.ts", code)).toEqual([]);
  });

  it.each(ARTIFACTS)("$label binds no reserved word", (artifact) => {
    const path = ensureFreshArtifact(artifact.path, artifact.build);
    const { label, violations } = scanFile(path);
    expect(violations.map((v) => format(label, v))).toEqual([]);
  });

  it.each(SOURCE_GROUPS)("$label bind no reserved word", (group) => {
    const found: string[] = [];
    for (const file of group.files) {
      const { label, violations } = scanFile(file);
      for (const violation of violations) found.push(format(label, violation));
    }
    expect(found).toEqual([]);
  });

  it("vendored ExtendScript binds no reserved word", () => {
    const found: string[] = [];
    for (const file of VENDORED_EXTENDSCRIPT) {
      const { label, violations } = scanFile(file);
      for (const violation of violations) found.push(format(label, violation));
    }
    expect(found).toEqual([]);
  });

  // A guard is only as wide as its file list, and this one used to scan a single
  // file. If the inventory silently shrinks, the suite must not go quiet.
  it("scans the whole shipped surface, not a sample", () => {
    const artifactBytes = ARTIFACTS.map(
      (artifact) => statSync(ensureFreshArtifact(artifact.path, artifact.build)).size,
    );
    expect(ARTIFACTS.length).toBeGreaterThanOrEqual(5);
    expect(artifactBytes.reduce((a, b) => a + b, 0)).toBeGreaterThan(500_000);

    const sourceFiles = SOURCE_GROUPS.flatMap((group) => group.files);
    expect(SOURCE_GROUPS.length).toBeGreaterThanOrEqual(4);
    expect(sourceFiles.length).toBeGreaterThan(30);
    // The two hand-written exporters — where the `char` bug lived — are in.
    expect(sourceFiles.some((f) => f.endsWith("plugins/illustrator/exporter.jsx"))).toBe(true);
    expect(sourceFiles.some((f) => f.endsWith("plugins/after-effects/exporter.jsx"))).toBe(true);
  });
});
