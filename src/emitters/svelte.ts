/**
 * Svelte 5 component emitter.
 *
 * Consumes the semantic node tree (`buildHTMLTree()` via `buildComponentTree()`),
 * not serialized HTML — see `shared/component-tree.ts` for what that retires.
 *
 * Snippet placeholders become **real Svelte 5 snippet props**: the tree is split
 * at each `data-replaceable` node, the ancestors leading to it are emitted as
 * real Svelte elements, and the placeholder's content becomes `{@render key?.()}`.
 * Everything else is still one opaque `{@html}` chunk, which is what keeps
 * author-written `html-before` / `html-after` blocks and inline SVG away from
 * the Svelte compiler. A document with no snippets and no bindings therefore
 * produces exactly one chunk, as before.
 */

import { createWarning, type StructuredWarning, warningMessages } from "../core/warnings.js";
import type { CustomBlock, EmitterReadyDocument } from "../ir/types.js";
import type { EmitGroupOptions } from "./html-tree.js";
import {
  ASSETS_TOKEN,
  buildComponentTree,
  CSS_NOT_RULE_LIST_CODE,
  escapeTemplateLiteral,
  SNIPPET_PROP_RENAMED_CODE,
  snippetPropRenamedMessage,
} from "./shared/component-tree.js";
import { type CssRuleListIssue, isRuleList, toRuleList } from "./shared/css-rule-list.js";
import { escapeAttr } from "./shared/escape.js";
import type { HtmlAttrs } from "./shared/html-node.js";
import { serializeHtml } from "./shared/html-node.js";
import { jsStringLiteral } from "./shared/js-identifier.js";
import type { ComponentSegment } from "./shared/replaceable-nodes.js";
import type { SvelteEmitterOptions } from "./types.js";

export interface EmitSvelteResult {
  svelte: string;
  /** Plain-string projection of `structuredWarnings`. */
  warnings: string[];
  structuredWarnings: StructuredWarning[];
}

/**
 * Svelte reads `{` and `}` in attribute values as an expression. Character
 * references are decoded by the Svelte parser, so this keeps a literal brace
 * literal without needing to quote the whole value as an expression.
 */
function svelteAttrValue(value: string): string {
  return escapeAttr(value).replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
}

function renderAttrs(attrs: HtmlAttrs): string {
  let out = "";
  for (const [name, value] of attrs) {
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      out += ` ${name}`;
      continue;
    }
    // Only asset paths need the runtime prop; everything else stays literal.
    if (value.indexOf(ASSETS_TOKEN) !== -1) {
      out += ` ${name}={resolveHtml(\`${escapeTemplateLiteral(value)}\`)}`;
      continue;
    }
    out += ` ${name}="${svelteAttrValue(value)}"`;
  }
  return out;
}

function htmlChunk(markup: string): string {
  return `{@html resolveHtml(\`${escapeTemplateLiteral(markup)}\`)}`;
}

function renderSegments(segments: ComponentSegment[], indent: string): string[] {
  const lines: string[] = [];

  for (const segment of segments) {
    if (segment.kind === "markup") {
      const markup = serializeHtml(segment.nodes);
      if (markup.trim() === "") continue;
      lines.push(indent + htmlChunk(markup));
      continue;
    }

    if (segment.kind === "host") {
      const { tag, attrs } = segment.node;
      lines.push(`${indent}<${tag}${renderAttrs(attrs)}>`);
      lines.push(...renderSegments(segment.children, `${indent}  `));
      lines.push(`${indent}</${tag}>`);
      continue;
    }

    const { node, marker, fallback } = segment;
    const open = `<${node.tag}${renderAttrs(node.attrs)}>`;
    const close = `</${node.tag}>`;

    if (marker.type === "snippet") {
      lines.push(`${indent}${open}{@render ${marker.propName}?.()}${close}`);
      continue;
    }

    const ref = `bindings[${jsStringLiteral(marker.path)}]`;
    const paraOpen = marker.paragraphClassName
      ? `<p class="${svelteAttrValue(marker.paragraphClassName)}">`
      : "<p>";
    const bound = marker.allowHtml ? `{@html ${ref}}` : `{${ref}}`;
    const fallbackMarkup = serializeHtml(fallback);
    lines.push(
      `${indent}${open}{#if ${ref} != null}${paraOpen}${bound}</p>{:else}${htmlChunk(fallbackMarkup)}{/if}${close}`,
    );
  }

  return lines;
}

function describeIssues(issues: CssRuleListIssue[]): string {
  const seen: string[] = [];
  for (const issue of issues) {
    const label =
      issue.kind === "declaration"
        ? `a declaration outside any rule: "${issue.excerpt}"`
        : issue.kind === "unclosed"
          ? `an unclosed rule: "${issue.excerpt}"`
          : `text that is not a rule: "${issue.excerpt}"`;
    if (seen.indexOf(label) === -1) seen.push(label);
  }
  return seen.slice(0, 3).join("; ");
}

/**
 * Make the stylesheet safe to place inside `:global { … }`.
 *
 * Svelte's `:global` block accepts rules and at-statements only, so a custom
 * `css` block containing a bare declaration, a stray `}` or an unclosed rule is
 * a **compile error in the generated component** — a build failure whose message
 * points at `Graphic.svelte`, not at the CSS the author actually wrote. The HTML
 * emitter degrades gracefully in the same situation (the browser drops the junk),
 * so this drops it too and warns, naming the offending custom block.
 */
function prepareGlobalCss(
  css: string,
  customBlocks: readonly CustomBlock[],
): { css: string; warnings: StructuredWarning[] } {
  const scan = toRuleList(css);
  if (scan.issues.length === 0) return { css, warnings: [] };

  const warnings: StructuredWarning[] = [];
  const cssBlocks = customBlocks.filter((block) => block.type === "css");
  let attributed = false;
  for (let i = 0; i < cssBlocks.length; i++) {
    if (isRuleList(cssBlocks[i].content)) continue;
    attributed = true;
    const issues = toRuleList(cssBlocks[i].content).issues;
    warnings.push(
      createWarning(
        CSS_NOT_RULE_LIST_CODE,
        "markup",
        `Custom CSS block ${i + 1} of ${cssBlocks.length} is not a valid list of CSS rules (${describeIssues(issues)}). Svelte components scope their stylesheet with ":global { … }", which holds rules only, so that CSS was dropped from the Svelte output. Put every declaration inside a selector block and balance the braces.`,
      ),
    );
  }
  if (!attributed) {
    warnings.push(
      createWarning(
        CSS_NOT_RULE_LIST_CODE,
        "markup",
        `The generated stylesheet is not a valid list of CSS rules (${describeIssues(scan.issues)}). Svelte components scope their stylesheet with ":global { … }", which holds rules only, so that CSS was dropped from the Svelte output.`,
      ),
    );
  }
  return { css: scan.css, warnings };
}

export function emitSvelte(
  doc: EmitterReadyDocument,
  groupOptions?: EmitGroupOptions,
  options?: SvelteEmitterOptions,
): EmitSvelteResult {
  const tree = buildComponentTree(doc, groupOptions, options);
  const structuredWarnings = [...tree.structuredWarnings];
  for (const rename of tree.propNameRenames) {
    structuredWarnings.push(
      createWarning(
        SNIPPET_PROP_RENAMED_CODE,
        "markup",
        snippetPropRenamedMessage(rename.key, rename.propName, rename.reason),
      ),
    );
  }

  const props = ['assetsPath = "."', 'class: className = ""'];
  for (const snippet of tree.snippets) props.push(snippet.propName);
  if (tree.bindings.length > 0) props.push("bindings = {}");

  const propDocs: string[] = [];
  if (tree.snippets.length > 0) {
    propDocs.push(
      "  // Snippet props, one per snippet placeholder in the design file.",
      "  // Pass a Svelte snippet to fill one; omit it and the slot renders nothing.",
      "  // `snippetKeys`, exported above, maps each prop back to its layer name.",
    );
  }
  if (tree.bindings.length > 0) {
    propDocs.push(
      "  // `bindings` replaces tagged text by path. Omit a path to keep the",
      "  // text exported from the design file. `bindingPaths`, exported above,",
      "  // lists every path.",
    );
  }

  // Layer names and binding paths are user text, so they are emitted as string
  // literals in a data position — never inside a comment, where a newline or a
  // `</script` would end the comment (or the whole script element) and turn a
  // layer name into executable source. See `js-identifier.ts`.
  const moduleExports: string[] = [];
  if (tree.snippets.length > 0) {
    const entries = tree.snippets
      .map((s) => `${jsStringLiteral(s.propName)}: ${jsStringLiteral(s.key)}`)
      .join(", ");
    moduleExports.push(
      "  // Snippet prop name → the design-file layer name it came from.",
      `  export const snippetKeys = { ${entries} };`,
    );
  }
  if (tree.bindings.length > 0) {
    const entries = tree.bindings.map((b) => jsStringLiteral(b.path)).join(", ");
    moduleExports.push(
      "  // Every tagged-text path this component accepts in `bindings`.",
      `  export const bindingPaths = [${entries}];`,
    );
  }
  const moduleScript =
    moduleExports.length > 0 ? `<script module>\n${moduleExports.join("\n")}\n</script>\n\n` : "";

  const fontHead = tree.googleFontsHref
    ? `<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${escapeAttr(tree.googleFontsHref)}">
</svelte:head>

`
    : "";

  const body = renderSegments(tree.segments, "  ").join("\n");

  const prepared = prepareGlobalCss(tree.css, doc.customBlocks);
  for (const warning of prepared.warnings) structuredWarnings.push(warning);

  // The markup ships through {@html}, which the Svelte compiler cannot see into,
  // so an unwrapped <style> block would be pruned as unused selectors. The CSS is
  // already namespaced by `#{ns}{slug}-box`, so `:global` is the correct scope.
  const svelte = `${moduleScript}<script>
  let { ${props.join(", ")} } = $props();
${propDocs.length > 0 ? `${propDocs.join("\n")}\n` : ""}
  // Replace asset path token in HTML at render time
  const ASSET_TOKEN = "${ASSETS_TOKEN}";

  function resolveHtml(html) {
    const safePath = assetsPath.replace(/\\/+$/, "");
    return html.split(ASSET_TOKEN).join(safePath);
  }
</script>

${fontHead}<div class={className}>
${body}
</div>

<style>
:global {
${prepared.css}
}
</style>
`;

  return { svelte, warnings: warningMessages(structuredWarnings), structuredWarnings };
}
