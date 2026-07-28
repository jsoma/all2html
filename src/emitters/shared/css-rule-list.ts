/**
 * Is this stylesheet a *rule list*?
 *
 * The Svelte emitter wraps the whole stylesheet in `:global { … }` so the
 * compiler does not prune selectors it cannot see (the markup ships through
 * `{@html}`). Svelte's CSS parser is strict about what may appear directly
 * inside that block: rules and at-statements only. A top-level declaration
 * (`color: red;`), a stray `}`, or an unclosed rule is a **hard compile error**
 * — `css_global_block_invalid_declaration` / `css_expected_identifier` /
 * `unexpected_eof` — and the message points at the generated component rather
 * than at the author's `css` block that caused it.
 *
 * Author CSS reaches the stylesheet verbatim (custom `css` blocks), so all three
 * are reachable from a real newsroom file, and `test/fixtures/ir/escaping-adversarial.json`
 * hits the first one. HTML degrades gracefully there — a browser drops the junk
 * and keeps the rest — so this module reproduces that behavior for Svelte:
 * scan the stylesheet, keep every well-formed item, and report what was dropped
 * so the emitter can warn naming the block.
 *
 * The scanner is not a CSS parser. It only needs to find top-level item
 * boundaries, so it tracks strings, comments, `url(`-style parens and brace
 * depth, and nothing else.
 *
 * Node-only: not part of the ExtendScript bundle.
 */

export interface CssRuleListIssue {
  /**
   * - `declaration` — a declaration at the top level, outside any rule.
   * - `stray` — text that is neither a rule nor a statement (a lone `}`, junk).
   * - `unclosed` — a rule whose block never closed; kept, with `}` appended.
   */
  kind: "declaration" | "stray" | "unclosed";
  /** A short excerpt of the offending source, for the warning message. */
  excerpt: string;
}

export interface CssRuleListScan {
  /** The input reduced to a well-formed rule list. Identical to the input when `issues` is empty. */
  css: string;
  issues: CssRuleListIssue[];
}

const EXCERPT_LIMIT = 60;

function excerptOf(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > EXCERPT_LIMIT ? `${collapsed.slice(0, EXCERPT_LIMIT)}…` : collapsed;
}

/** Index just past the comment starting at `i` (which points at `/`). */
function skipComment(css: string, i: number): number {
  const end = css.indexOf("*/", i + 2);
  return end === -1 ? css.length : end + 2;
}

/** Index just past the string starting at `i` (which points at the quote). */
function skipString(css: string, i: number): number {
  const quote = css.charAt(i);
  let j = i + 1;
  while (j < css.length) {
    const chr = css.charAt(j);
    if (chr === "\\") {
      j += 2;
      continue;
    }
    if (chr === quote) return j + 1;
    // An unterminated string ends at the newline, as CSS says it does.
    if (chr === "\n") return j;
    j++;
  }
  return css.length;
}

/** Index just past the balanced `(` … `)` starting at `i`. */
function skipParens(css: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < css.length) {
    const chr = css.charAt(j);
    if (chr === "/" && css.charAt(j + 1) === "*") {
      j = skipComment(css, j);
      continue;
    }
    if (chr === '"' || chr === "'") {
      j = skipString(css, j);
      continue;
    }
    if (chr === "(") depth++;
    else if (chr === ")") {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return css.length;
}

/** Whether a prelude is nothing but whitespace and comments. */
function isBlank(text: string): boolean {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").trim() === "";
}

/** The prelude with comments and leading whitespace removed, for classification. */
function preludeStart(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").trim();
}

/**
 * Reduce `css` to something that can be placed directly inside a rule-list
 * context (a `:global { … }` block, or a plain stylesheet).
 *
 * Returns the input unchanged when it is already well formed, so the common case
 * is byte-for-byte identical to what the emitter produced.
 */
export function toRuleList(css: string): CssRuleListScan {
  const kept: string[] = [];
  const issues: CssRuleListIssue[] = [];
  let start = 0;
  let i = 0;

  const push = (text: string): void => {
    if (text !== "") kept.push(text);
  };

  while (i < css.length) {
    const chr = css.charAt(i);

    if (chr === "/" && css.charAt(i + 1) === "*") {
      i = skipComment(css, i);
      continue;
    }
    if (chr === '"' || chr === "'") {
      i = skipString(css, i);
      continue;
    }
    if (chr === "(") {
      i = skipParens(css, i);
      continue;
    }

    if (chr === "{") {
      // A rule: prelude + a balanced block. Nested braces are consumed here, so
      // `@media`/`@container`/nesting all stay one item.
      let depth = 0;
      let j = i;
      let closed = false;
      while (j < css.length) {
        const inner = css.charAt(j);
        if (inner === "/" && css.charAt(j + 1) === "*") {
          j = skipComment(css, j);
          continue;
        }
        if (inner === '"' || inner === "'") {
          j = skipString(css, j);
          continue;
        }
        if (inner === "(") {
          j = skipParens(css, j);
          continue;
        }
        if (inner === "{") depth++;
        else if (inner === "}") {
          depth--;
          if (depth === 0) {
            closed = true;
            j++;
            break;
          }
        }
        j++;
      }
      if (closed) {
        push(css.slice(start, j));
      } else {
        // CSS closes an unterminated block at EOF; do the same rather than drop
        // an entire rule over a missing brace.
        push(`${css.slice(start, css.length)}\n}`);
        issues.push({ kind: "unclosed", excerpt: excerptOf(css.slice(start, i + 1)) });
      }
      start = j;
      i = j;
      continue;
    }

    if (chr === ";") {
      const text = css.slice(start, i + 1);
      const head = preludeStart(text);
      if (head === "" || head.charAt(0) === "@") {
        // `@import`/`@charset`/`@namespace` — a statement, legal in a rule list.
        push(text);
      } else {
        issues.push({ kind: "declaration", excerpt: excerptOf(text) });
      }
      start = i + 1;
      i = start;
      continue;
    }

    if (chr === "}") {
      // Unbalanced closer: drop it along with whatever preceded it, since that
      // text is not a rule either.
      issues.push({ kind: "stray", excerpt: excerptOf(css.slice(start, i + 1)) });
      start = i + 1;
      i = start;
      continue;
    }

    i++;
  }

  const tail = css.slice(start);
  if (isBlank(tail)) push(tail);
  else issues.push({ kind: "stray", excerpt: excerptOf(tail) });

  if (issues.length === 0) return { css, issues };
  return { css: kept.join(""), issues };
}

/** Whether `css` can be placed in a rule-list context untouched. */
export function isRuleList(css: string): boolean {
  return toRuleList(css).issues.length === 0;
}
