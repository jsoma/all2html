/**
 * The serializable HTML node tree, and the one serializer that renders it.
 *
 * SPEC §12.6 / decision D23. `html.ts` and `html-string.ts` used to be two
 * ~550-line emitters with an identical function decomposition, differing only in
 * whether they built hast nodes or concatenated strings. They were kept in sync
 * by test alone and had already silently diverged. Now there is one builder
 * (`html-tree.ts`) producing this tree of plain JSON-serializable objects, and
 * this serializer.
 *
 * THE ESCAPING RULE
 * -----------------
 * **The serializer owns all escaping. Builders pass RAW values and never
 * pre-escape.** That is what retires the parity bug class by construction rather
 * than by test: there is exactly one place where a value meets a grammar, and it
 * picks the grammar from the node's position in the tree, not from the call site.
 *
 * Four distinct grammars, all single-sourced in `escape.ts`:
 *
 *   - `text` nodes            → `escapeHtml`          (`&` and `<`)
 *   - attribute values        → `escapeAttr`          (NUL, `"`, `&`, `'`, backtick)
 *   - `comment` nodes         → `sanitizeCommentText` (breaks `<!--` / `-->` / `--!>`)
 *   - `script` / `style` text → `escapeScriptContent` / `escapeStyleContent`
 *
 * Attribute and text escaping are deliberately *different* subsets, both copied
 * from `hast-util-to-html` so `toHast()` round-trips byte-identically. Do not
 * widen either without re-proving that parity (`emitter-escaping-parity.test.ts`).
 *
 * A fifth grammar exists and is deliberately *not* handled here: CSS URLs go
 * through `toCssUrlValue()` in `shared/assets.ts` before they become part of a
 * `style` attribute value, because CSS string escaping is not HTML escaping.
 * The result is then attribute-escaped like any other attribute value.
 *
 * `raw` nodes are the one escape hatch — intentional HTML from custom blocks,
 * inline SVG layers and html-hook layers. `trust: "application"` is there so a
 * grep for raw output finds every site, and so a raw node cannot be built by
 * accident from a JSON parse of untrusted input.
 *
 * ATTRIBUTE ORDER
 * ---------------
 * Attributes are an *ordered array of pairs*, not an object. The string emitter
 * used to depend on `Object.keys` insertion order, which ES3 does not guarantee
 * — and ExtendScript's `Object.keys` is a `for...in` polyfill, so the shipped
 * artifact was relying on unspecified behavior for byte-identical output. Pairs
 * make the order a property of the data.
 *
 * A pair whose value is `undefined`, `null` or `false` is omitted entirely; a
 * pair whose value is `true` emits as a bare boolean attribute (`autoplay`,
 * `muted`, `loop`, `playsinline`, `crossorigin`). Everything else emits as
 * `name="escaped"` with double quotes.
 *
 * ES3-safe: this module ships inside the ExtendScript bundle.
 */

import {
  escapeAttr,
  escapeHtml,
  escapeScriptContent,
  escapeStyleContent,
  sanitizeCommentText,
} from "./escape.js";

export type HtmlAttrValue = string | boolean | null | undefined;

/** One attribute, as a `[name, value]` pair. Order is significant. */
export type HtmlAttr = [string, HtmlAttrValue];

/** An element's attributes, in emission order. */
export type HtmlAttrs = HtmlAttr[];

export interface HtmlElementNode {
  kind: "element";
  tag: string;
  attrs: HtmlAttrs;
  children: HtmlNode[];
}

/** Text content. Escaped with the text grammar by the serializer. */
export interface HtmlTextNode {
  kind: "text";
  value: string;
}

/**
 * Verbatim markup. `trust: "application"` marks this as a deliberate decision by
 * emitter code, never a value that flowed in from a document field unexamined.
 */
export interface HtmlRawNode {
  kind: "raw";
  value: string;
  trust: "application";
}

/** An HTML comment. The body is sanitized by the serializer. */
export interface HtmlCommentNode {
  kind: "comment";
  value: string;
}

export type HtmlNode = HtmlElementNode | HtmlTextNode | HtmlRawNode | HtmlCommentNode;

/**
 * Void elements emit no closing tag and ignore children.
 * `img`, `link` and `meta` are the ones this codebase builds; the rest are here
 * so the serializer is correct for any tag rather than only for today's callers.
 */
const VOID_ELEMENTS = " area base br col embed hr img input link meta param source track wbr ";

export function isVoidElement(tag: string): boolean {
  return VOID_ELEMENTS.indexOf(" " + tag + " ") > -1;
}

/**
 * Raw-text elements. The HTML tokenizer does not decode character references
 * inside them, so HTML-escaping their content would corrupt it. Instead the
 * text is *neutralized* against the sequences that terminate the element —
 * `</script` / `<!--` and `</style` / `<!--` — which is what closed the two
 * confirmed XSS holes (a `</style>` breakout through font mappings, and the
 * `<!--<script>` document swallow through custom JS blocks).
 */
export function neutralizeRawText(tag: string, value: string): string | null {
  if (tag === "script") return escapeScriptContent(value);
  if (tag === "style") return escapeStyleContent(value);
  return null;
}

export function el(tag: string, attrs?: HtmlAttrs, children?: HtmlNode[]): HtmlElementNode {
  return { kind: "element", tag: tag, attrs: attrs || [], children: children || [] };
}

export function text(value: string): HtmlTextNode {
  return { kind: "text", value: value };
}

/** Intentionally unescaped markup. See `HtmlRawNode`. */
export function raw(value: string): HtmlRawNode {
  return { kind: "raw", value: value, trust: "application" };
}

export function comment(value: string): HtmlCommentNode {
  return { kind: "comment", value: value };
}

export function serializeAttrs(attrs: HtmlAttrs): string {
  let out = "";
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i][0];
    const value = attrs[i][1];
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      out += " " + name;
      continue;
    }
    out += " " + name + '="' + escapeAttr(value) + '"';
  }
  return out;
}

function serializeElement(node: HtmlElementNode): string {
  const tag = node.tag;
  const open = "<" + tag + serializeAttrs(node.attrs) + ">";
  // Void elements have no closing tag and no content model. Children on one are
  // a builder bug; dropping them is the only serialization that is valid HTML.
  if (isVoidElement(tag)) return open;

  let inner = "";
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.kind === "text") {
      const neutralized = neutralizeRawText(tag, child.value);
      inner += neutralized === null ? escapeHtml(child.value) : neutralized;
      continue;
    }
    inner += serializeNode(child);
  }
  return open + inner + "</" + tag + ">";
}

function serializeNode(node: HtmlNode): string {
  if (node.kind === "text") return escapeHtml(node.value);
  if (node.kind === "raw") return node.value;
  if (node.kind === "comment") return "<!-- " + sanitizeCommentText(node.value) + " -->";
  return serializeElement(node);
}

/** Render a node tree to HTML. The only place escaping happens. */
export function serializeHtml(nodes: HtmlNode[]): string {
  let out = "";
  for (let i = 0; i < nodes.length; i++) {
    out += serializeNode(nodes[i]);
  }
  return out;
}
