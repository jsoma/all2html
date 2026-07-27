/**
 * Single source of truth for HTML escaping across every emitter.
 *
 * THE CONTRACT
 * ------------
 * The hast emitter (`html.ts`) hands raw values to `hast-util-to-html`, which
 * escapes them with its own fixed subsets. There is no option to widen those
 * subsets, so the *only* way the string emitter (`html-string.ts`) can produce
 * byte-identical output is to escape exactly the same characters that
 * `hast-util-to-html` escapes — no more, no less.
 *
 * The subsets below are copied from hast-util-to-html:
 *   - text nodes      → `['<', '&']`                    (lib/handle/text.js)
 *   - double-quoted   → `['\0', '"', '&', "'", '`']`    (lib/handle/element.js,
 *     attribute values   `constants.double[1][1]`)
 *   - comments        → `/^>|^->|<!--|-->|--!>|<!-$/`   (lib/handle/comment.js)
 *
 * Both subsets are still *sufficient* for safety:
 *   - In text/RCDATA content, escaping `&` and `<` is enough; a bare `>` or `"`
 *     cannot start a tag or close an attribute.
 *   - In a double-quoted attribute, escaping `&`, `"`, `'` and backtick is
 *     enough; `<`/`>` cannot terminate a quoted attribute value.
 *
 * These helpers are compiled into the ExtendScript bundle, so keep them ES5.
 */

const ATTR_REPLACEMENTS: Record<string, string> = {
  "\u0000": "&#x0;",
  '"': "&quot;",
  "&": "&amp;",
  "'": "&#x27;",
  "`": "&#x60;",
};

// NUL is deliberately part of the subset — hast escapes it to `&#x0;` and
// we must match byte for byte.
// biome-ignore lint/suspicious/noControlCharactersInRegex: mirrors hast's attribute subset
const ATTR_PATTERN = /[\u0000"&'`]/g;

/**
 * Escape a value for use inside a double-quoted HTML attribute.
 * Matches `hast-util-to-html`'s double-quoted attribute subset exactly.
 */
export function escapeAttr(value: string): string {
  // NB: the parameter must not be named `char` — it is a reserved word in
  // ExtendScript and this module ships inside that bundle. A live Illustrator
  // run failed with "Error 9: Illegal use of reserved word 'char'" while the
  // entire Node suite passed.
  return String(value).replace(ATTR_PATTERN, (ch) => ATTR_REPLACEMENTS[ch]);
}

/**
 * Escape a value for use as HTML text content.
 * Matches `hast-util-to-html`'s text-node subset exactly (`&` and `<` only).
 *
 * Do NOT use this for attribute values — use {@link escapeAttr}.
 */
export function escapeHtml(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

const COMMENT_UNSAFE = /<!--|--!>|-->/;
const COMMENT_UNSAFE_GLOBAL = /<!--|--!>|-->/g;

function breakCommentSequence(match: string): string {
  // Insert a space between the two dashes so the sequence can no longer be
  // parsed as a comment delimiter, while keeping the text readable.
  // `<!--` → `<!- -`, `-->` → `- ->`, `--!>` → `- -!>`
  return match.charAt(0) === "<" ? "<!- -" : "- " + match.slice(1);
}

/**
 * Neutralize comment-delimiter sequences in text destined for an HTML comment.
 *
 * `hast-util-to-html` rewrites `<!--`, `-->` and `--!>` inside comments into
 * character references. Rather than replicating that encoding in the string
 * emitter, both emitters run values through this sanitizer first, which leaves
 * hast's comment regex with nothing to match — so both emit the same bytes.
 *
 * (`^>`, `^->` and `<!-$` are also in hast's regex, but both emitters always
 * pad the comment body with a leading and trailing space, so they can't match.)
 */
export function sanitizeCommentText(value: string): string {
  let out = String(value);
  // A replacement can create a new sequence across its boundary (e.g.
  // `<!--->`), so iterate until stable. Each pass strictly reduces the number
  // of adjacent `--` pairs, so this always terminates.
  let guard = out.length + 1;
  while (guard-- > 0 && COMMENT_UNSAFE.test(out)) {
    out = out.replace(COMMENT_UNSAFE_GLOBAL, breakCommentSequence);
  }
  return out;
}

/** Render a complete HTML comment, matching the hast emitter byte for byte. */
export function renderComment(value: string): string {
  return "<!-- " + sanitizeCommentText(value) + " -->";
}

/**
 * Neutralize the sequences that let text inside an inline `<script>` element
 * escape it.
 *
 * Both emitters write custom JS blocks verbatim into a `<script>` element, and
 * the HTML tokenizer treats that content as *script data*, which has three
 * relevant transitions:
 *
 *   1. `</script` ends the element outright, regardless of JS string/comment
 *      context.
 *   2. `<!--` switches to *script-data-escaped*, where `-->` matters.
 *   3. `<script` while escaped switches to *script-data-double-escaped*, where
 *      a plain `</script>` no longer closes the element — so everything after
 *      the block (including the trailing `<!-- End all2html -->` comment) gets
 *      swallowed as script text.
 *
 * A backslash before the `/`, `!` or `s` breaks all three for the tokenizer
 * while staying inert inside JS string literals (`\X` is a NonEscapeCharacter
 * that evaluates to `X`). Note the one place inertness does *not* hold: inside
 * a regex literal `\s` is the whitespace class and `\!` is invalid under the
 * `u` flag, so `/<script/` and `/<!--/u` change meaning. Breaking `<!--` alone
 * is what actually stops the breakout — the `<script` rule is defense in depth.
 */
export function escapeScriptContent(value: string): string {
  // Only these two sequences matter. `</script` ends the element directly, and
  // `<!--` is what lets the tokenizer enter script-data-double-escaped state,
  // where a later `</script>` no longer closes it.
  //
  // A third rule neutralizing bare `<script` was tried and deliberately removed:
  // it is redundant (blocking `<!--` already makes the double-escaped state
  // unreachable) and it actively corrupts valid author JS. Inside a regex
  // literal, `/<script/` would become `/<\script/`, where `\s` silently means
  // the whitespace class rather than the letter `s`. Rewriting a user's working
  // regex into a different-but-valid one is worse than the redundancy it buys.
  return String(value)
    .replace(/<\/(script)/gi, "<\\/$1")
    .replace(/<!--/g, "<\\!--");
}

/**
 * Neutralize the sequences that let text inside an inline `<style>` element
 * escape it.
 *
 * `<style>` content is *RAWTEXT*, so only `</style` terminates it — but `<!--`
 * is also neutralized because CSS treats it as a CDO token and dropping it
 * costs nothing. A backslash is a valid CSS escape, so `<\/style` still parses
 * as CSS while no longer closing the element.
 *
 * The reachable sink here is not author-written CSS: font mappings
 * (`all2html.config.json`, document XMP, the panel font editor) land in
 * `font-family` values, and custom `css` blocks land verbatim.
 */
export function escapeStyleContent(value: string): string {
  return String(value)
    .replace(/<\/(style)/gi, "<\\/$1")
    .replace(/<!--/g, "<\\!--");
}

const SAFE_URL_SCHEMES = ["http", "https", "mailto", "tel"];

/**
 * Allowlist the URL schemes that may appear in an emitted `href`.
 *
 * Escaping cannot help here — `javascript:alert(1)` survives every attribute
 * escape intact — so hrefs are checked against a scheme allowlist instead.
 * Relative URLs and fragments are allowed; everything else must carry one of
 * {@link SAFE_URL_SCHEMES}.
 *
 * Browsers strip ASCII whitespace and C0 controls while parsing a URL, so
 * `java\tscript:`, `\njavascript:` and `  javascript:` are all live. The scheme
 * is therefore matched against a stripped probe of the value.
 */
export function isSafeUrl(value: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: mirrors the URL parser's stripping
  const probe = String(value).replace(/[\u0000-\u0020\u007F]/g, "");
  const colon = probe.indexOf(":");
  // No scheme at all: relative URL, protocol-relative `//host`, or `#fragment`.
  if (colon === -1) return true;
  // A colon inside the path, query or fragment does not introduce a scheme.
  const slash = probe.indexOf("/");
  const question = probe.indexOf("?");
  const hash = probe.indexOf("#");
  if (slash > -1 && slash < colon) return true;
  if (question > -1 && question < colon) return true;
  if (hash > -1 && hash < colon) return true;
  const scheme = probe.slice(0, colon).toLowerCase();
  for (let i = 0; i < SAFE_URL_SCHEMES.length; i++) {
    if (SAFE_URL_SCHEMES[i] === scheme) return true;
  }
  return false;
}

/** The single warning text for a rejected URL, so both emitters agree. */
export function unsafeUrlWarning(context: string, value: string): string {
  return (
    "Blocked " +
    context +
    ' with a disallowed URL scheme: "' +
    String(value) +
    '". Allowed: ' +
    SAFE_URL_SCHEMES.join(", ") +
    ", fragments and relative URLs."
  );
}
