/**
 * Template system supporting Mustache and EJS syntax.
 * Variables are looked up case-insensitively in the replacements object.
 *
 * **Substituted values are HTML-escaped unless the caller says otherwise.**
 * A template slot can sit anywhere — element text, an attribute value, inside a
 * `title` — so the escape here is a *superset* of the narrowed subsets in
 * `src/emitters/shared/escape.ts`, which exist to stay byte-identical with
 * `hast-util-to-html` in one specific position each.
 *
 * "Anywhere" includes the position this module used to get wrong: an **unquoted
 * attribute value**. `<div data-t={{h}}>` with `h = 'x onmouseover=alert(1)'`
 * emitted a live event handler, because `& < > " '` leaves the characters
 * HTML's unquoted-attribute-value grammar actually terminates on — whitespace
 * and `>` — alone. The same hole exists in attribute-*name* and tag-name
 * position. See `escapeTemplateValue` for the set and the reasoning.
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

/**
 * The escape set, and why it is this one.
 *
 * A template is an arbitrary file on disk that this module knows nothing about,
 * so the position a slot lands in is unknown. Three designs were available:
 *
 *  a. Detect the slot's grammar position and escape accordingly. Rejected: doing
 *     it correctly needs a real HTML tokenizer over the template, and the cheap
 *     approximations fail *open*. Scanning backwards for the nearest `<`/`>`
 *     misreads `<div title="a > b" data-t={{h}}>` as "outside a tag" and applies
 *     the weaker escape in exactly the position that needs the stronger one.
 *  b. Reject a slot found in unquoted-attribute position. Same detection
 *     problem, plus it pushes a failure mode onto every template author.
 *  c. Escape the union of what every position needs, unconditionally. Chosen:
 *     there is nothing to detect, nothing for a future call site to get wrong,
 *     and no way to opt into the weaker behavior by accident. The only opt-out
 *     is `rawTemplateValue()`, which is greppable.
 *
 * So the set is `& < > " '` (text, quoted attributes, and `>` for good measure)
 * plus everything the unquoted-attribute-value / attribute-name / tag-name
 * states terminate on or treat specially: the four HTML whitespace characters
 * (tab, LF, FF, space), `=` and the backtick. With whitespace encoded, a value
 * can no longer split itself into a second attribute; with `=` encoded, it
 * cannot give one a value even if it could.
 *
 * The cost is cosmetic and bounded: numeric character references decode back to
 * the original character in both text and attribute contexts, so the *rendered*
 * page is unchanged — only the source bytes are noisier (`Breaking&#32;News`).
 * The one context where they would not decode is a raw-text element (`<script>`,
 * `<style>`) in the template, and a slot there was already broken by `&amp;`.
 *
 * CR is deliberately absent: the HTML parser normalizes CR/CRLF to LF before
 * tokenizing, so it can only ever behave as the LF that is already covered, and
 * encoding it would change `\r\n` into `\r&#10;` for no gain.
 */
const TEMPLATE_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "\t": "&#9;",
  "\n": "&#10;",
  "\f": "&#12;",
  " ": "&#32;",
  "=": "&#61;",
  "`": "&#96;",
};

const TEMPLATE_ESCAPE_PATTERN = /[&<>"'\t\n\f =`]/g;

function escapeTemplateValue(value: string): string {
  return value.replace(TEMPLATE_ESCAPE_PATTERN, (ch) => TEMPLATE_ESCAPES[ch]);
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
