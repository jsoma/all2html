/**
 * Template system supporting Mustache and EJS syntax.
 * Variables are looked up case-insensitively in the replacements object.
 *
 * **Substituted values are escaped for the grammar position they land in, and a
 * slot that lands in a position no escape can make safe is rejected.**
 *
 * WHY NOT ONE UNIVERSAL ESCAPE TABLE
 * ----------------------------------
 * The previous implementation escaped the union of every position's terminators
 * (`& < > " '`, the HTML whitespace set, `=`, backtick) unconditionally, on the
 * theory that escaping a superset removes the need to know the position. It does
 * not, in three ways that were all demonstrated:
 *
 *  1. **CR was omitted** because "the parser normalizes CR to LF before
 *     tokenizing". True of the parser — but the escape runs *before* the document
 *     is parsed, so a raw CR survives substitution and the parser then turns it
 *     into exactly the LF the table was removing. `h = "x\ronmouseover"` in an
 *     unquoted attribute produced a live event handler. Any "escape the union"
 *     table is one forgotten codepoint away from this; there is no way to test
 *     that a blacklist is complete.
 *  2. **Attribute-*name* position is unfixable by escaping.** `<div {{h}}>` puts
 *     the value where a name goes. Encoding its whitespace does not make it a
 *     name — it makes it a *different* name. No value escape helps.
 *  3. **Raw-text position is unfixable by escaping.** A slot inside `<script>` or
 *     `<style>` is read by the JS/CSS parser, which does not decode character
 *     references at all: `&lt;` is four literal characters and `&#39;` does not
 *     close a JS string, so the escaped value still executes.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 * The template is a small, author-supplied file read once at emit time, so it is
 * cheap to tokenize properly. `scanTemplate()` walks it with an HTML tokenizer
 * state machine and records the state it is in at each slot's offset — with the
 * slots themselves treated as opaque, so `<%= x %>` cannot be mistaken for a tag.
 * This is *not* the backwards-scan heuristic a previous pass correctly rejected:
 * that one misreads `<div title="a > b" data-t={{h}}>`; a forward tokenizer that
 * has actually seen the quoted value does not.
 *
 * Then, per slot:
 *
 *   - text / RCDATA (`title`, `textarea`) → text escape. Character references
 *     *are* decoded in RCDATA, and escaping `<` makes `</title` unwritable.
 *   - quoted attribute value (either quote) → attribute escape. `escapeAttr`
 *     covers both quote characters, so single-quoted attributes are safe too.
 *   - comment → comment sanitization, so a value cannot close the comment and
 *     turn the rest of the author's comment body into live markup.
 *   - **everything else → rejected.** Tag name, attribute name, unquoted
 *     attribute value, `script`/`style` raw text, doctype, bogus comment. The
 *     slot is left in the output *verbatim* and a structured warning names the
 *     placeholder and the position.
 *
 * Rejecting is the correct outcome, not a cop-out: `localPreviewTemplate` is an
 * author-controlled local preview file, so `{{headline}}` in attribute-name
 * position is a mistake in the template and the author should be told. And it
 * fails closed by construction — the bytes emitted for a rejected slot are the
 * template's own bytes, so the output can never be *more* dangerous than the
 * input file the author already wrote.
 *
 * Escaping is single-sourced from `src/emitters/shared/escape.ts`; this module
 * defines no escape table of its own. That module's subsets are narrowed to match
 * `hast-util-to-html`, which is a byte-parity constraint on the emitters, but each
 * subset is independently *sufficient* for its own position — see its header.
 *
 * The only values that must survive verbatim are the ones that *are* markup — the
 * emitted HTML fragment the standalone emitter substitutes for `ai2htmlPartial`.
 * Those are wrapped with `rawTemplateValue()`, so opting out of escaping is an
 * explicit, greppable act at the call site. A raw value is honored in text
 * position only; anywhere else it is rejected like any other unsafe slot, because
 * markup spliced into an attribute or a `<script>` is markup in the wrong grammar
 * however much we trust it.
 *
 * This module is NOT part of the ExtendScript bundle (verified:
 * `grep -c applyTemplate dist/extendscript/all2html-core.js` → 0), so it is free
 * of the ES3 constraints the rest of `src/core` carries.
 */

import { escapeAttr, escapeHtml, sanitizeCommentText } from "../emitters/shared/escape.js";
import { hasOwn, opaqueKey } from "./identifiers.js";
import { createWarning, type StructuredWarning, type WarningContext } from "./warnings.js";

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

export interface TemplateResult {
  output: string;
  /** Slots rejected because of the grammar position they landed in. */
  warnings: StructuredWarning[];
}

/**
 * Both syntaxes in one alternation, matched in a single pass on purpose: two
 * sequential passes would rescan already-substituted content, so a value
 * containing `<%= x %>` could be re-expanded by the second. Matching produces
 * offsets, and the output is assembled from template slices around them, so
 * substituted text is never re-examined.
 */
const VARIABLE_RE = /\{\{\{?\s*([\w-]+)\s*\}?\}\}|<%[=-]\s*([\w-]+)\s*%>/g;

interface Slot {
  start: number;
  end: number;
  /** The raw placeholder text, e.g. `{{headline}}`. */
  text: string;
  name: string | undefined;
}

/**
 * The tokenizer states this module distinguishes. A subset of the HTML tokenizer
 * states — enough to classify every position a slot can occupy, and no more.
 */
type TokenizerState =
  | "text"
  | "rcdata"
  | "rawtext"
  | "comment"
  | "bogus-comment"
  | "doctype"
  | "tag-name"
  | "before-attribute-name"
  | "attribute-name"
  | "after-attribute-name"
  | "before-attribute-value"
  | "attribute-value-double"
  | "attribute-value-single"
  | "attribute-value-unquoted"
  | "after-attribute-value-quoted"
  | "self-closing-start-tag";

type SlotContext =
  | { kind: "text" }
  | { kind: "rcdata" }
  | { kind: "attribute" }
  | { kind: "comment" }
  | { kind: "reject"; position: string };

/** The four characters HTML calls whitespace. CR included — see the header. */
const HTML_WHITESPACE = /[\t\n\f\r ]/;

/** RAWTEXT-ish elements whose content is not HTML and where escaping is inert. */
const RAW_TEXT_TAGS = ["script", "style"];

/** RCDATA elements: markup is inert but character references still decode. */
const RCDATA_TAGS = ["title", "textarea"];

function isAsciiAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

function contextForState(
  state: TokenizerState,
  rawTag: string,
  atCommentStart: boolean,
): SlotContext {
  switch (state) {
    case "text":
      return { kind: "text" };
    case "rcdata":
      return { kind: "rcdata" };
    case "comment":
      // `<!-->` and `<!--->` are *valid empty comments*: a value that begins
      // with `>` or `->` at the very start of the body closes the comment
      // immediately, and the author's remaining comment text becomes live
      // markup. Nothing can be escaped inside a comment to prevent that, so the
      // one offset where it is reachable is refused. Anywhere else in the body,
      // `sanitizeCommentText()` is sufficient.
      return atCommentStart
        ? { kind: "reject", position: "the first position of an HTML comment" }
        : { kind: "comment" };
    case "attribute-value-double":
    case "attribute-value-single":
      return { kind: "attribute" };
    case "rawtext":
      return { kind: "reject", position: `<${rawTag}> raw text` };
    case "tag-name":
      return { kind: "reject", position: "a tag name" };
    case "before-attribute-name":
    case "attribute-name":
    case "after-attribute-name":
    case "after-attribute-value-quoted":
    case "self-closing-start-tag":
      return { kind: "reject", position: "an attribute name" };
    case "before-attribute-value":
    case "attribute-value-unquoted":
      return { kind: "reject", position: "an unquoted attribute value" };
    case "doctype":
      return { kind: "reject", position: "a doctype declaration" };
    case "bogus-comment":
      return { kind: "reject", position: "a bogus comment" };
  }
}

/**
 * Walk the template with an HTML tokenizer and report the state each slot sits
 * in. Slots are skipped over as opaque spans rather than tokenized, so neither
 * `{{` nor `<%` can steer the machine — the state at a slot is decided entirely
 * by the template text *around* it, which is what makes the classification
 * trustworthy.
 *
 * Every unhandled construct fails toward a rejecting state: an unterminated
 * `<script>` leaves the scanner in `rawtext` to the end of the file, and an
 * unterminated tag leaves it in an attribute state, so downstream slots are
 * rejected rather than silently escaped for the wrong grammar.
 */
function scanTemplate(template: string, slots: readonly Slot[]): SlotContext[] {
  const contexts: SlotContext[] = [];
  const length = template.length;
  let slotIndex = 0;
  let state: TokenizerState = "text";
  let tagName = "";
  let isEndTag = false;
  let rawTag = "";
  let commentBodyStart = -1;
  let i = 0;

  /** Does the next unconsumed slot begin exactly at `offset`? */
  const slotStartsAt = (offset: number): boolean =>
    slotIndex < slots.length && slots[slotIndex].start === offset;

  // Called when a tag's `>` is consumed: a start tag for a raw-text or RCDATA
  // element switches the content model for everything up to its end tag.
  //
  // It *returns* the next state rather than assigning it, so every write to
  // `state` happens in the loop body. Assigning from inside a closure is
  // invisible to TypeScript's control-flow analysis, which then decides the
  // `rawtext` and `rcdata` cases of the switch below are unreachable.
  const contentModelAfterTag = (): TokenizerState => {
    if (isEndTag) return "text";
    if (RAW_TEXT_TAGS.indexOf(tagName) !== -1) {
      rawTag = tagName;
      return "rawtext";
    }
    if (RCDATA_TAGS.indexOf(tagName) !== -1) {
      rawTag = tagName;
      return "rcdata";
    }
    return "text";
  };

  while (i <= length) {
    // A slot can start where the previous one ended, so drain them all.
    while (slotIndex < slots.length && slots[slotIndex].start === i) {
      contexts.push(contextForState(state, rawTag, i === commentBodyStart));
      i = slots[slotIndex].end;
      slotIndex++;
    }
    if (i >= length) break;

    const ch = template.charAt(i);
    switch (state) {
      case "text": {
        if (ch !== "<") {
          i++;
          break;
        }
        // A slot sitting immediately after `<` is in tag-name position even
        // though the tokenizer is still in text state here: HTML's
        // "invalid-first-character-of-tag-name" rule looks at the character
        // *after* the `<`, and that character is the value's, not the
        // template's. `<{{h}}>` with `h = "div onload=alert(1)"` therefore opens
        // a real tag, and the text escape (which touches only `&` and `<`)
        // leaves every character of it intact. Same for `</`.
        if (slotStartsAt(i + 1)) {
          state = "tag-name";
          isEndTag = false;
          tagName = "";
          i += 1;
          break;
        }
        if (template.charAt(i + 1) === "/" && slotStartsAt(i + 2)) {
          state = "tag-name";
          isEndTag = true;
          tagName = "";
          i += 2;
          break;
        }
        if (template.slice(i, i + 4) === "<!--") {
          state = "comment";
          commentBodyStart = i + 4;
          i += 4;
          break;
        }
        if (template.charAt(i + 1) === "!") {
          if (template.slice(i, i + 9).toLowerCase() === "<!doctype") {
            state = "doctype";
            i += 9;
            break;
          }
          state = "bogus-comment";
          i += 2;
          break;
        }
        if (template.charAt(i + 1) === "/") {
          if (isAsciiAlpha(template.charAt(i + 2))) {
            state = "tag-name";
            isEndTag = true;
            tagName = "";
            i += 2;
            break;
          }
          state = "bogus-comment";
          i += 2;
          break;
        }
        if (template.charAt(i + 1) === "?") {
          state = "bogus-comment";
          i += 2;
          break;
        }
        if (isAsciiAlpha(template.charAt(i + 1))) {
          state = "tag-name";
          isEndTag = false;
          tagName = "";
          i += 1;
          break;
        }
        // `<` followed by anything else is literal text to the parser.
        i++;
        break;
      }

      case "rawtext":
      case "rcdata": {
        if (
          ch === "<" &&
          template.charAt(i + 1) === "/" &&
          template.slice(i + 2, i + 2 + rawTag.length).toLowerCase() === rawTag
        ) {
          const after = template.charAt(i + 2 + rawTag.length);
          if (after === "" || after === "/" || after === ">" || HTML_WHITESPACE.test(after)) {
            state = "tag-name";
            isEndTag = true;
            tagName = rawTag;
            i += 2 + rawTag.length;
            break;
          }
        }
        i++;
        break;
      }

      case "tag-name": {
        if (HTML_WHITESPACE.test(ch)) {
          state = "before-attribute-name";
          i++;
          break;
        }
        if (ch === "/") {
          state = "self-closing-start-tag";
          i++;
          break;
        }
        if (ch === ">") {
          state = contentModelAfterTag();
          i++;
          break;
        }
        tagName += ch.toLowerCase();
        i++;
        break;
      }

      case "before-attribute-name": {
        if (HTML_WHITESPACE.test(ch)) {
          i++;
          break;
        }
        if (ch === "/") {
          state = "self-closing-start-tag";
          i++;
          break;
        }
        if (ch === ">") {
          state = contentModelAfterTag();
          i++;
          break;
        }
        // Includes `=`, which HTML folds into the attribute name.
        state = "attribute-name";
        i++;
        break;
      }

      case "attribute-name": {
        if (HTML_WHITESPACE.test(ch)) {
          state = "after-attribute-name";
          i++;
          break;
        }
        if (ch === "/") {
          state = "self-closing-start-tag";
          i++;
          break;
        }
        if (ch === "=") {
          state = "before-attribute-value";
          i++;
          break;
        }
        if (ch === ">") {
          state = contentModelAfterTag();
          i++;
          break;
        }
        i++;
        break;
      }

      case "after-attribute-name": {
        if (HTML_WHITESPACE.test(ch)) {
          i++;
          break;
        }
        if (ch === "/") {
          state = "self-closing-start-tag";
          i++;
          break;
        }
        if (ch === "=") {
          state = "before-attribute-value";
          i++;
          break;
        }
        if (ch === ">") {
          state = contentModelAfterTag();
          i++;
          break;
        }
        state = "attribute-name";
        i++;
        break;
      }

      case "before-attribute-value": {
        if (HTML_WHITESPACE.test(ch)) {
          i++;
          break;
        }
        if (ch === '"') {
          state = "attribute-value-double";
          i++;
          break;
        }
        if (ch === "'") {
          state = "attribute-value-single";
          i++;
          break;
        }
        if (ch === ">") {
          state = contentModelAfterTag();
          i++;
          break;
        }
        state = "attribute-value-unquoted";
        i++;
        break;
      }

      case "attribute-value-double": {
        if (ch === '"') state = "after-attribute-value-quoted";
        i++;
        break;
      }

      case "attribute-value-single": {
        if (ch === "'") state = "after-attribute-value-quoted";
        i++;
        break;
      }

      case "attribute-value-unquoted": {
        if (HTML_WHITESPACE.test(ch)) {
          state = "before-attribute-name";
          i++;
          break;
        }
        if (ch === ">") {
          state = contentModelAfterTag();
          i++;
          break;
        }
        i++;
        break;
      }

      case "after-attribute-value-quoted": {
        if (HTML_WHITESPACE.test(ch)) {
          state = "before-attribute-name";
          i++;
          break;
        }
        if (ch === "/") {
          state = "self-closing-start-tag";
          i++;
          break;
        }
        if (ch === ">") {
          state = contentModelAfterTag();
          i++;
          break;
        }
        // Missing whitespace between attributes: reconsume in the name state.
        state = "before-attribute-name";
        break;
      }

      case "self-closing-start-tag": {
        if (ch === ">") {
          state = contentModelAfterTag();
          i++;
          break;
        }
        state = "before-attribute-name";
        break;
      }

      case "comment": {
        if (template.slice(i, i + 3) === "-->") {
          state = "text";
          i += 3;
          break;
        }
        if (template.slice(i, i + 4) === "--!>") {
          state = "text";
          i += 4;
          break;
        }
        i++;
        break;
      }

      case "bogus-comment":
      case "doctype": {
        if (ch === ">") state = "text";
        i++;
        break;
      }
    }
  }

  // A slot past the last processed offset can only happen if the template ends
  // mid-slot, which the regex cannot produce; classify defensively anyway.
  while (slotIndex < slots.length) {
    contexts.push(contextForState(state, rawTag, false));
    slotIndex++;
  }

  return contexts;
}

function isRawValue(value: TemplateValue): value is RawTemplateValue {
  return typeof value !== "string";
}

/**
 * Replacement records are keyed with `opaqueKey()` (`src/core/identifiers.js`)
 * and read with own-property checks only. The old raw-keyed `in` lookup walked
 * the prototype chain, so `{{toString}}` resolved to
 * `Object.prototype.toString` (and was then silently erased downstream), while
 * a metadata key named `__proto__` could never be written at all. An unknown
 * variable — including `{{toString}}` now — is left in the output verbatim.
 */
function lookupVar(
  name: string,
  replacements: Record<string, TemplateValue>,
): TemplateValue | undefined {
  const exactKey = opaqueKey(name);
  if (hasOwn(replacements, exactKey)) return replacements[exactKey];
  const lowerKey = opaqueKey(name.toLowerCase());
  if (hasOwn(replacements, lowerKey)) return replacements[lowerKey];
  // Case-insensitive search over the record's own keys
  for (const key of Object.keys(replacements)) {
    if (key.toLowerCase() === lowerKey) return replacements[key];
  }
  return undefined;
}

function lineOf(template: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (template.charAt(i) === "\n") line++;
  }
  return line;
}

/** The one code for "a slot was refused because of where it sits". */
const UNSAFE_SLOT_CODE = "emit:template-unsafe-slot";

function rejectionWarning(
  template: string,
  slot: Slot,
  position: string,
  isRaw: boolean,
  context: WarningContext | undefined,
): StructuredWarning {
  const where = `line ${lineOf(template, slot.start)}`;
  const reason = isRaw
    ? `carries emitted markup but sits in ${position}, which is not a markup context`
    : `sits in ${position}, where escaping cannot make a value safe`;
  return createWarning(
    UNSAFE_SLOT_CODE,
    "template",
    `Template slot ${slot.text} (${where}) ${reason}. It was left unsubstituted; ` +
      `move it into element text or a quoted attribute value.`,
    context,
  );
}

/**
 * Substitute `replacements` into `template`, escaping each value for the grammar
 * position its slot occupies and refusing the positions where no escape works.
 *
 * **`replacements` keys must be built with `opaqueKey()`** from
 * `src/core/identifiers.js` — variable name `headline` is stored under
 * `opaqueKey("headline")`. Prefixing on write is what lets a variable named
 * `__proto__` exist at all (a raw write is a silent no-op on a plain object),
 * and own-property reads are what keep `{{toString}}` from resolving to
 * `Object.prototype.toString`.
 *
 * `context` is attached to every warning produced — the caller knows which
 * setting the template came from, this module does not.
 */
export function applyTemplate(
  template: string,
  replacements: Record<string, TemplateValue>,
  context?: WarningContext,
): TemplateResult {
  const slots: Slot[] = [];
  VARIABLE_RE.lastIndex = 0;
  let match = VARIABLE_RE.exec(template);
  while (match !== null) {
    const name = match[1] !== undefined ? match[1] : match[2];
    slots.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      name: name,
    });
    match = VARIABLE_RE.exec(template);
  }
  if (slots.length === 0) return { output: template, warnings: [] };

  const contexts = scanTemplate(template, slots);
  const warnings: StructuredWarning[] = [];
  const parts: string[] = [];
  let cursor = 0;

  for (let k = 0; k < slots.length; k++) {
    const slot = slots[k];
    parts.push(template.slice(cursor, slot.start));
    cursor = slot.end;

    const value = slot.name === undefined ? undefined : lookupVar(slot.name, replacements);
    if (value === undefined) {
      // Unknown variable: left as-is, and not a security event.
      parts.push(slot.text);
      continue;
    }

    const slotContext = contexts[k];
    const raw = isRawValue(value);

    if (slotContext.kind === "reject") {
      warnings.push(rejectionWarning(template, slot, slotContext.position, raw, context));
      parts.push(slot.text);
      continue;
    }

    if (raw) {
      // Markup only belongs in a markup context.
      if (slotContext.kind !== "text") {
        const position =
          slotContext.kind === "attribute"
            ? "a quoted attribute value"
            : slotContext.kind === "comment"
              ? "an HTML comment"
              : "RCDATA text";
        warnings.push(rejectionWarning(template, slot, position, true, context));
        parts.push(slot.text);
        continue;
      }
      parts.push(value.raw);
      continue;
    }

    switch (slotContext.kind) {
      case "text":
      case "rcdata":
        parts.push(escapeHtml(value));
        break;
      case "attribute":
        parts.push(escapeAttr(value));
        break;
      case "comment":
        parts.push(sanitizeCommentText(value));
        break;
    }
  }

  parts.push(template.slice(cursor));
  return { output: parts.join(""), warnings: warnings };
}
