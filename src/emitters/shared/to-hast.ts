/**
 * Adapter from the canonical node tree (`html-node.ts`) to hast.
 *
 * Nothing in this repo consumes a hast tree at runtime — the emitters use their
 * own serializer, which is what ships into ExtendScript. `toHast()` has exactly
 * one live caller, and it is a test.
 *
 * This is **not** a published extension point, and it should not be described as
 * one until it is actually exported: `package.json` has no `exports` entry for
 * `./emitters/shared/to-hast.js` and `src/index.ts` does not re-export it, so an
 * npm consumer cannot reach it at all. Exporting it would also have to move
 * `@types/hast` into `dependencies`, because the emitted `.d.ts` names `Root`.
 * Repo-internal code and anyone vendoring `src/` can import it directly today;
 * that is the whole of its reach.
 *
 * What it *is* is the *proof* that the serializer's escaping contract is
 * still hast's own: `test/unit/html-serializer.test.ts` renders every IR fixture
 * through both paths and asserts byte equality. If `hast-util-to-html` ever
 * changes a subset, that test fails rather than the output silently drifting.
 *
 * Node-only: `hast` and `hast-util-to-html` never enter the ExtendScript bundle.
 */

import type { Element, Properties, Root, RootContent } from "hast";
import { sanitizeCommentText } from "./escape.js";
import { type HtmlAttrs, type HtmlNode, isVoidElement, neutralizeRawText } from "./html-node.js";

function toProperties(attrs: HtmlAttrs): Properties {
  const properties: Properties = {};
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i][0];
    const value = attrs[i][1];
    if (value === undefined || value === null || value === false) continue;
    properties[name] = value;
  }
  return properties;
}

function toHastNode(node: HtmlNode): RootContent {
  if (node.kind === "text") {
    return { type: "text", value: node.value };
  }
  if (node.kind === "raw") {
    // hast has no `raw` node in its own types; `hast-util-to-html` understands it
    // under `allowDangerousHtml`, which is how intentional markup survives.
    return { type: "raw", value: node.value } as unknown as RootContent;
  }
  if (node.kind === "comment") {
    // Sanitize here rather than letting hast's comment encoder fire, so both
    // renderers emit the same bytes. See `escape.ts`.
    return { type: "comment", value: " " + sanitizeCommentText(node.value) + " " };
  }

  const children: RootContent[] = [];
  if (!isVoidElement(node.tag)) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.kind === "text") {
        // Raw-text elements (`script`, `style`) are not character-reference
        // decoded by the tokenizer, so hast emits their text verbatim. The
        // element-terminating sequences must be neutralized first — the
        // serializer does this too, from the same helper.
        const neutralized = neutralizeRawText(node.tag, child.value);
        if (neutralized !== null) {
          children.push({ type: "text", value: neutralized });
          continue;
        }
      }
      children.push(toHastNode(child));
    }
  }

  const element: Element = {
    type: "element",
    tagName: node.tag,
    properties: toProperties(node.attrs),
    children: children as Element["children"],
  };
  return element;
}

/** Convert a node tree to a hast root, for rehype-based post-processing. */
export function toHast(nodes: HtmlNode[]): Root {
  const children: RootContent[] = [];
  for (let i = 0; i < nodes.length; i++) {
    children.push(toHastNode(nodes[i]));
  }
  return { type: "root", children };
}

/** The `hast-util-to-html` options the adapter's output is meant to be used with. */
export const HAST_TO_HTML_OPTIONS = {
  allowDangerousHtml: true,
  characterReferences: { useNamedReferences: true },
} as const;
