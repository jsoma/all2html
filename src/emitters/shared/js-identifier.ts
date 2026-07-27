/**
 * Turning design-tool text into JavaScript source, safely.
 *
 * Snippet keys are **layer names**, and layer names are arbitrary user text that
 * ends up inside a `.svelte` / `.jsx` file the desk then compiles. Two separate
 * hazards follow from that, and this module owns both:
 *
 *  1. **Identifiers.** A key becomes a component prop name. Sanitizing to
 *     `[A-Za-z0-9_$]` is not enough: `default` is a keyword (SyntaxError),
 *     `cssText` / `resolveHtml` / `htmlChunks` are identifiers the emitters
 *     themselves declare (silent shadowing — a layer named `cssText` made the
 *     generated `<style>` render the snippet prop instead of the stylesheet),
 *     and a `$`-prefixed name is rejected outright by the Svelte compiler.
 *     {@link safeIdentifier} is therefore total: every input maps to a name that
 *     is a valid identifier, is not a reserved word, and is not one of the
 *     identifiers either emitter generates. {@link uniqueIdentifier} then makes
 *     the result unique inside one component, deterministically.
 *
 *     The reserved set is deliberately the **union** across both emitters, so a
 *     given key produces the same prop name in Svelte and in React.
 *
 *  2. **String literals.** User text that has to appear in emitted JS goes
 *     through {@link jsStringLiteral}, never into a comment. `JSON.stringify`
 *     alone is not sufficient there: it leaves U+2028/U+2029 raw (line
 *     terminators to a JS parser) and leaves `<` raw (so `</script>` inside a
 *     Svelte `<script>` block closes the element — the HTML tokenizer does not
 *     care that it is inside a JS string).
 *
 * Node-only: not part of the ExtendScript bundle.
 */

/**
 * Reserved words, strict-mode reserved words, the old future-reserved set, and
 * the literals. Anything here would be a SyntaxError or a confusing binding as a
 * destructured parameter name.
 */
const JS_RESERVED_WORDS = [
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  // Literals and globals that are not keywords but must not be shadowed.
  "undefined",
  "NaN",
  "Infinity",
  "globalThis",
  // ES3 / early-ES5 future reserved words. Cheap to keep clear of.
  "abstract",
  "boolean",
  "byte",
  "char",
  "double",
  "final",
  "float",
  "goto",
  "int",
  "long",
  "native",
  "short",
  "synchronized",
  "throws",
  "transient",
  "volatile",
];

/**
 * TypeScript's own keyword set. Most are contextual and legal as a property
 * name, but the `.tsx` variant of the React component puts these names in both
 * a binding position and an interface member position, and a rename costs one
 * underscore.
 */
const TS_RESERVED_WORDS = [
  "any",
  "asserts",
  "bigint",
  "declare",
  "infer",
  "is",
  "keyof",
  "module",
  "namespace",
  "never",
  "number",
  "object",
  "out",
  "override",
  "readonly",
  "require",
  "satisfies",
  "string",
  "symbol",
  "type",
  "unique",
  "unknown",
];

/**
 * Every identifier the generated components declare or reference themselves.
 *
 * Keep this in sync with `svelte.ts` and `react.ts`. A name missing here is not
 * a compile error — it is a *silent shadow*, which is strictly worse.
 */
const GENERATED_IDENTIFIERS = [
  // Component surface, both emitters.
  "assetsPath",
  "bindings",
  "children",
  "class",
  "className",
  "html",
  "safePath",
  // Emitted metadata (both).
  "bindingPaths",
  "snippetKeys",
  // Svelte.
  "resolveHtml",
  "ASSET_TOKEN",
  // React.
  "CONTENTS",
  "JSX",
  "React",
  "ReactNode",
  "chunk",
  "cssText",
  "googleFontsHref",
  "htmlChunks",
  "props",
  "useMemo",
];

/**
 * Svelte runes and the compiler's own `$$`-prefixed bindings. Every one of these
 * already starts with `$`, which {@link sanitizeIdentifier} rewrites, but they
 * are listed so the intent survives a change to that rule.
 */
const SVELTE_RESERVED = [
  "$bindable",
  "$derived",
  "$effect",
  "$host",
  "$inspect",
  "$props",
  "$state",
  "$$props",
  "$$restProps",
  "$$slots",
];

const RESERVED: { [name: string]: true } = {};
for (const name of JS_RESERVED_WORDS) RESERVED[name] = true;
for (const name of TS_RESERVED_WORDS) RESERVED[name] = true;
for (const name of GENERATED_IDENTIFIERS) RESERVED[name] = true;
for (const name of SVELTE_RESERVED) RESERVED[name] = true;

/** Whether `name` may not be used as a generated prop name. */
export function isReservedIdentifier(name: string): boolean {
  return RESERVED[name] === true;
}

/** The reserved names, sorted. Exported for tests and documentation. */
export function reservedIdentifiers(): string[] {
  return Object.keys(RESERVED).sort();
}

/**
 * Character-level sanitization only: the result always matches
 * `/^[A-Za-z_][A-Za-z0-9_$]*$/`. It may still be a reserved word — see
 * {@link safeIdentifier}.
 *
 * A leading `$` is rewritten rather than kept: Svelte 5 rejects *every*
 * `$`-prefixed binding (`dollar_prefix_invalid`), runes or not.
 */
export function sanitizeIdentifier(raw: string): string {
  let name = String(raw).replace(/[^A-Za-z0-9_$]/g, "_");
  if (name === "" || /^[0-9$]/.test(name)) name = `_${name}`;
  return name;
}

/**
 * A valid, non-reserved identifier for `raw`. Total: every input has an answer,
 * and equal inputs always produce equal output.
 */
export function safeIdentifier(raw: string): string {
  const name = sanitizeIdentifier(raw);
  return isReservedIdentifier(name) ? `${name}_` : name;
}

/**
 * Make `base` unique against `taken`, deterministically: `base`, `base_2`,
 * `base_3`, … The chosen name is added to `taken`.
 */
export function uniqueIdentifier(base: string, taken: { [name: string]: true }): string {
  if (taken[base] !== true && !isReservedIdentifier(base)) {
    taken[base] = true;
    return base;
  }
  let candidate = `${base}_`;
  let counter = 2;
  while (taken[candidate] === true || isReservedIdentifier(candidate)) {
    candidate = `${base}_${counter}`;
    counter++;
  }
  taken[candidate] = true;
  return candidate;
}

/**
 * A JS string literal for arbitrary user text, safe in every context this repo
 * emits into: a `.jsx`/`.tsx` module, and a Svelte `<script>` block (which the
 * HTML tokenizer scans for `</script` without regard for JS string context).
 *
 * `<` is escaped rather than only `</script`, because the same literal also has
 * to survive `<!--` (script-data-escaped) and `</style` inside a `<style>`.
 */
export function jsStringLiteral(value: string): string {
  return JSON.stringify(String(value))
    .replace(/</g, "\\u003C")
    .replace(/[\u2028\u2029]/g, (ch) => (ch === "\u2028" ? "\\u2028" : "\\u2029"));
}
