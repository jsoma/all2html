/**
 * The shared input to the Svelte and React emitters (SPEC §12.6 / D23).
 *
 * Both used to call the HTML emitter for a *string* and then take it apart with
 * regexes: one to pull the `<style>` block back out, one to drop the Google
 * Fonts `<link>` tags, and `/<!--[\s\S]*?-->/g` to remove comments — which also
 * ate comments an author had written inside their own `html-before` /
 * `html-after` blocks. None of that is necessary once the emitters consume
 * `buildHTMLTree()`, because every one of those things is a distinguishable
 * node.
 *
 *   - the stylesheet is the top-level `<style>` element; it is *removed from the
 *     tree*, not matched out of a string, and its text becomes the component's
 *     scoped CSS;
 *   - the font `<link>` tags are simply never built — the tree is built with
 *     `googleFonts: "none"` and the href is carried out separately, because in a
 *     component it belongs in `<svelte:head>` / the JSX head, not in an injected
 *     HTML string;
 *   - comments are left alone.
 *
 * Node-only: not part of the ExtendScript bundle.
 */

import type { StructuredWarning } from "../../core/warnings.js";
import type { EmitterReadyDocument } from "../../ir/types.js";
import { buildHTMLTree, type EmitGroupOptions } from "../html-tree.js";
import type { EmitterOptions } from "../types.js";
import { buildGoogleFontsUrl } from "./google-fonts.js";
import { type HtmlNode, neutralizeRawText } from "./html-node.js";
import {
  type BindingMarker,
  type ComponentSegment,
  collectReplaceables,
  type PropNameRename,
  type SnippetMarker,
  segmentTree,
} from "./replaceable-nodes.js";

/**
 * Stands in for the caller's asset directory inside emitted markup, and is
 * replaced with the `assetsPath` prop at render time. Placed by overriding
 * `imageSourcePath`, so it lands natively in both `src="…"` and `url(…)`.
 */
export const ASSETS_TOKEN = "__ALL2HTML_ASSETS__";

export interface ComponentTree {
  /** Contents of the stylesheet the tree carried, verbatim. */
  css: string;
  /** The tree minus the stylesheet, split at replaceable placeholders. */
  segments: ComponentSegment[];
  /** Non-null only when `settings.googleFonts === "link"`. */
  googleFontsHref: string | null;
  snippets: SnippetMarker[];
  bindings: BindingMarker[];
  propNameRenames: PropNameRename[];
  structuredWarnings: StructuredWarning[];
}

/**
 * Lift the stylesheet out of the tree.
 *
 * The text is neutralized with the **same grammar the serializer would have
 * applied** (`neutralizeRawText("style", …)`), because it is going straight back
 * into a `<style>` raw-text context — the Svelte component's `<style>` block and
 * React's `dangerouslySetInnerHTML` on `<style>`. Taking the node's raw value
 * would drop that: a `</style>` inside an author's custom CSS block would close
 * the element in the generated component and everything after it would parse as
 * markup. That is the `</style>` breakout the escaping work closed for HTML, and
 * reading the tree instead of the serialized string is exactly where it could
 * come back.
 */
function takeStylesheet(nodes: HtmlNode[]): { css: string; rest: HtmlNode[] } {
  const rest: HtmlNode[] = [];
  let css = "";
  let taken = false;
  for (const node of nodes) {
    if (!taken && node.kind === "element" && node.tag === "style") {
      for (const child of node.children) {
        if (child.kind === "text") css += neutralizeRawText("style", child.value) ?? child.value;
        else if (child.kind === "raw") css += child.value;
      }
      taken = true;
      continue;
    }
    rest.push(node);
  }
  return { css, rest };
}

export function buildComponentTree(
  doc: EmitterReadyDocument,
  groupOptions?: EmitGroupOptions,
  options?: EmitterOptions,
): ComponentTree {
  const linkFonts = doc.settings.googleFonts === "link";
  const tokenizedDoc: EmitterReadyDocument = {
    ...doc,
    settings: {
      ...doc.settings,
      imageSourcePath: `${ASSETS_TOKEN}/`,
      // `"import"` is left alone: it resolves inside the stylesheet, which the
      // component still carries. Only `"link"` produces markup that has to move.
      googleFonts: linkFonts ? "none" : doc.settings.googleFonts,
    },
  };

  const { nodes, structuredWarnings } = buildHTMLTree(tokenizedDoc, groupOptions, options);
  const { css, rest } = takeStylesheet(nodes);
  const segments = segmentTree(rest);
  // Assigns the final prop names into the markers `segments` carries, so this
  // must run before anything renders them.
  const { snippets, bindings, propNameRenames } = collectReplaceables(segments);

  return {
    css,
    segments,
    googleFontsHref: linkFonts ? buildGoogleFontsUrl(doc.fonts) : null,
    snippets,
    bindings,
    propNameRenames,
    structuredWarnings,
  };
}

/** Escape a value for embedding inside a JS template literal. */
export function escapeTemplateLiteral(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

/**
 * Stable code for a snippet key that could not be used as a prop name verbatim.
 *
 * Renaming is never optional — a reserved word is a SyntaxError in the generated
 * component and a duplicate would silently render one snippet in two places — so
 * the warning exists to tell the author the name they will actually pass.
 */
export const SNIPPET_PROP_RENAMED_CODE = "emit:snippet-prop-renamed";

export function snippetPropRenamedMessage(
  key: string,
  propName: string,
  reason: "reserved" | "collision",
): string {
  const why =
    reason === "reserved"
      ? "that name is reserved by JavaScript or by the generated component"
      : "another snippet layer already claimed that name";
  return `Snippet layer "${key}" is exposed as the component prop "${propName}" because ${why}. Rename the layer if you want a different prop name.`;
}

/** Structured warning code for author CSS that Svelte's `:global {}` cannot hold. */
export const CSS_NOT_RULE_LIST_CODE = "emit:css-not-rule-list";
