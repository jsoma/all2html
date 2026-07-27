/**
 * Template system supporting Mustache and EJS syntax.
 * Variables are looked up case-insensitively in the replacements object.
 *
 * **Substituted values are HTML-escaped unless the caller says otherwise.**
 * A template slot can sit anywhere — element text, an attribute value, inside a
 * `title` — so the escape here is the full set (`&`, `<`, `>`, `"`, `'`) rather
 * than the narrowed subsets in `src/emitters/shared/escape.ts`, which exist to
 * stay byte-identical with `hast-util-to-html` in one specific position each.
 *
 * The only values that must survive verbatim are the ones that *are* markup —
 * the emitted HTML fragment the standalone emitter substitutes for
 * `ai2htmlPartial`. Those are wrapped with `rawTemplateValue()`, so opting out
 * of escaping is an explicit, greppable act at the call site and a new caller
 * that just passes strings is safe by construction.
 *
 * Escaping happens exactly once, here. Callers pass raw values.
 */

/**
 * A value substituted verbatim. `trust: "application"` mirrors the `raw()` node
 * in the HTML serializer: every place that bypasses escaping is greppable.
 */
export interface RawTemplateValue {
  raw: string;
  trust: "application";
}

export type TemplateValue = string | RawTemplateValue;

/** Mark a value as markup the template should receive unescaped. */
export function rawTemplateValue(value: string): RawTemplateValue {
  return { raw: value, trust: "application" };
}

/**
 * Both syntaxes in one alternation, applied in a single pass on purpose: two
 * sequential `replace` calls would rescan already-substituted content, so a
 * value containing `<%= x %>` could be re-expanded by the second pass.
 */
const VARIABLE_RE = /\{\{\{?\s*([\w-]+)\s*\}?\}\}|<%[=-]\s*([\w-]+)\s*%>/g;

function escapeTemplateValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isRawValue(value: TemplateValue): value is RawTemplateValue {
  return typeof value !== "string";
}

function lookupVar(
  name: string,
  replacements: Record<string, TemplateValue>,
): TemplateValue | undefined {
  if (name in replacements) return replacements[name];
  const lower = name.toLowerCase();
  if (lower in replacements) return replacements[lower];
  // Case-insensitive search
  for (const key of Object.keys(replacements)) {
    if (key.toLowerCase() === lower) return replacements[key];
  }
  return undefined;
}

export function applyTemplate(
  template: string,
  replacements: Record<string, TemplateValue>,
): string {
  return template.replace(
    VARIABLE_RE,
    (match, mustacheName: string | undefined, ejsName: string | undefined) => {
      const name = mustacheName !== undefined ? mustacheName : ejsName;
      if (name === undefined) return match;
      const value = lookupVar(name, replacements);
      if (value === undefined) return match;
      return isRawValue(value) ? value.raw : escapeTemplateValue(value);
    },
  );
}
