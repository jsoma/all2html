/**
 * React component emitter.
 *
 * Consumes the semantic node tree (`buildHTMLTree()` via `buildComponentTree()`),
 * not serialized HTML — see `shared/component-tree.ts` for what that retires.
 *
 * Snippet placeholders become **real props**: the tree is split at each
 * `data-replaceable` node, the ancestors leading to it are emitted as real JSX,
 * and the placeholder renders `{snippetProp}`. Everything with no replaceable
 * inside it stays one `dangerouslySetInnerHTML` chunk.
 *
 * The static markup is *not* fully converted to JSX — see the note in
 * `docs/internal` / the emitter README for what a real JSX emitter would need.
 * The short version: `raw` nodes (custom blocks, html-hook layers, inline SVG)
 * are arbitrary author HTML with no parse step available in the ES3-safe tree,
 * and inline SVG additionally needs SVG-attribute camelCasing. Converting only
 * the nodes we build ourselves and leaving those as innerHTML would be a half
 * conversion with two escaping models in one file.
 *
 * Chunk wrappers carry `display: contents` so they take part in no layout: the
 * generated CSS uses only descendant combinators, and artboard children are
 * absolutely positioned, so an inert wrapper changes nothing.
 *
 * Requires React 18+ at runtime. The TypeScript variant imports `JSX` (and
 * `ReactNode`, when the graphic has snippets) from `react`, which resolves with
 * React 19 types; nothing in this repo imports React itself.
 */

import { createWarning, type StructuredWarning, warningMessages } from "../core/warnings.js";
import type { EmitterReadyDocument } from "../ir/types.js";
import type { EmitGroupOptions } from "./html-tree.js";
import { assetBaseJoinRuntimeExpression } from "./shared/assets.js";
import {
  ASSETS_TOKEN,
  buildComponentTree,
  escapeTemplateLiteral,
  SNIPPET_PROP_RENAMED_CODE,
  snippetPropRenamedMessage,
} from "./shared/component-tree.js";
import type { HtmlAttrs } from "./shared/html-node.js";
import { serializeHtml } from "./shared/html-node.js";
import {
  isReservedIdentifier,
  jsStringLiteral,
  sanitizeIdentifier,
} from "./shared/js-identifier.js";
import { lazyVideoLoaderCall } from "./shared/lazy-video.js";
import type { ComponentSegment } from "./shared/replaceable-nodes.js";
import type { ReactEmitterOptions } from "./types.js";

export interface EmitReactResult {
  jsx: string;
  /** Plain-string projection of `structuredWarnings`. */
  warnings: string[];
  structuredWarnings: StructuredWarning[];
}

/**
 * HTML attribute names React spells differently. `data-*` / `aria-*` pass through.
 *
 * `class` and `for` are quoted because they are ExtendScript reserved words, and
 * that engine rejects a reserved word as an *unquoted* object-literal key
 * (`{"class":1}` parses, `{class:1}` does not). This emitter is not in the
 * ExtendScript entry graph today, so it is latent — but it is a plausible future
 * import, and quoting costs nothing.
 */
const ATTR_NAME_MAP: Record<string, string> = {
  autoplay: "autoPlay",
  "class": "className",
  crossorigin: "crossOrigin",
  "for": "htmlFor",
  playsinline: "playsInline",
  srcset: "srcSet",
  tabindex: "tabIndex",
};

function jsxAttrName(name: string): string {
  if (name.indexOf("data-") === 0 || name.indexOf("aria-") === 0) return name;
  return ATTR_NAME_MAP[name] ?? name;
}

/**
 * A JS expression for a value that may contain the asset token. `safePath` is in
 * scope wherever these are emitted (inside the component function body).
 */
function jsValue(value: string): string {
  if (value.indexOf(ASSETS_TOKEN) === -1) return JSON.stringify(value);
  // The token contains no `$` or backtick, so it survives template escaping intact.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a placeholder in the *generated* component, not here
  return `\`${escapeTemplateLiteral(value).split(ASSETS_TOKEN).join("${safePath}")}\``;
}

/** Split on a separator that is not inside quotes or parentheses (CSS `url(…)`). */
function splitCssTopLevel(value: string, separator: string, limit = Infinity): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const chr = value.charAt(i);
    if (quote) {
      if (chr === "\\") i++;
      else if (chr === quote) quote = "";
      continue;
    }
    if (chr === '"' || chr === "'") {
      quote = chr;
      continue;
    }
    if (chr === "(") depth++;
    else if (chr === ")") depth--;
    else if (chr === separator && depth === 0 && parts.length + 1 < limit) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function cssPropertyToJsx(property: string): string {
  // Custom properties are passed through verbatim; React sets them as-is.
  if (property.indexOf("--") === 0) return property;
  const camel = property.replace(/-([a-z])/g, (_m, chr: string) => chr.toUpperCase());
  // `-webkit-box` → `WebkitBox`, per React's vendor-prefix convention.
  return property.charAt(0) === "-" ? camel.charAt(0).toUpperCase() + camel.slice(1) : camel;
}

function isIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/** `top:10%;left:5%` → `{ top: "10%", left: "5%" }`. */
function styleObjectLiteral(style: string): string {
  const entries: string[] = [];
  for (const declaration of splitCssTopLevel(style, ";")) {
    if (declaration.trim() === "") continue;
    const [rawProperty, rawValue] = splitCssTopLevel(declaration, ":", 2);
    if (rawValue === undefined) continue;
    const key = cssPropertyToJsx(rawProperty.trim());
    entries.push(`${isIdentifier(key) ? key : JSON.stringify(key)}: ${jsValue(rawValue.trim())}`);
  }
  return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
}

function renderAttrs(attrs: HtmlAttrs): string {
  let out = "";
  for (const [name, value] of attrs) {
    if (value === undefined || value === null || value === false) continue;
    const jsxName = jsxAttrName(name);
    if (value === true) {
      out += ` ${jsxName}`;
      continue;
    }
    if (name === "style") {
      out += ` style={${styleObjectLiteral(value)}}`;
      continue;
    }
    // `&` disqualifies the literal fast path: JSX decodes character references in
    // a quoted attribute value exactly like HTML does, so a value that already
    // contains `&amp;` would render as `&` here while the HTML and Svelte
    // emitters (which escape it to `&amp;amp;`) render `&amp;`. Reachable from
    // `data-key`, `id`, `role` and `data-binding-path` — all user text.
    if (value.indexOf(ASSETS_TOKEN) === -1 && !/["\n{}&]/.test(value)) {
      out += ` ${jsxName}="${value}"`;
      continue;
    }
    out += ` ${jsxName}={${jsValue(value)}}`;
  }
  return out;
}

interface RenderContext {
  chunks: string[];
}

function chunkElement(markup: string, ctx: RenderContext): string {
  const index = ctx.chunks.length;
  ctx.chunks.push(markup);
  return `<div style={CONTENTS} dangerouslySetInnerHTML={{ __html: html[${index}] }} />`;
}

function renderSegments(
  segments: ComponentSegment[],
  indent: string,
  ctx: RenderContext,
): string[] {
  const lines: string[] = [];

  for (const segment of segments) {
    if (segment.kind === "markup") {
      const markup = serializeHtml(segment.nodes);
      if (markup.trim() === "") continue;
      lines.push(indent + chunkElement(markup, ctx));
      continue;
    }

    if (segment.kind === "host") {
      const { tag, attrs } = segment.node;
      lines.push(`${indent}<${tag}${renderAttrs(attrs)}>`);
      lines.push(...renderSegments(segment.children, `${indent}  `, ctx));
      lines.push(`${indent}</${tag}>`);
      continue;
    }

    const { node, marker, fallback } = segment;
    const open = `<${node.tag}${renderAttrs(node.attrs)}>`;
    const close = `</${node.tag}>`;

    if (marker.type === "snippet") {
      lines.push(`${indent}${open}{${marker.propName}}${close}`);
      continue;
    }

    const ref = `bindings[${jsStringLiteral(marker.path)}]`;
    const classAttr = marker.paragraphClassName ? ` className="${marker.paragraphClassName}"` : "";
    const bound = marker.allowHtml
      ? `<p${classAttr} dangerouslySetInnerHTML={{ __html: ${ref} }} />`
      : `<p${classAttr}>{${ref}}</p>`;
    lines.push(`${indent}${open}`);
    lines.push(`${indent}  {${ref} != null ? (`);
    lines.push(`${indent}    ${bound}`);
    lines.push(`${indent}  ) : (`);
    lines.push(`${indent}    ${chunkElement(serializeHtml(fallback), ctx)}`);
    lines.push(`${indent}  )}`);
    lines.push(`${indent}${close}`);
  }

  return lines;
}

export function emitReact(
  doc: EmitterReadyDocument,
  groupOptions?: EmitGroupOptions,
  options?: ReactEmitterOptions,
): EmitReactResult {
  const slug = groupOptions?.slug || doc.settings.projectName || doc.metadata.slug;
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

  // Generate component name from slug. The slug is normally already slugified,
  // but it can also arrive from `metadata.slug` or a caller-supplied group slug,
  // so it goes through the same total sanitization as every other identifier —
  // this is a `function <name>(` position.
  let componentName = slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  // Prefix if it does not start with a letter (e.g. "2024ElectionMap" → "Graphic2024ElectionMap")
  if (!/^[A-Za-z]/.test(componentName)) componentName = `Graphic${componentName}`;
  componentName = sanitizeIdentifier(componentName);
  // `React` would collide with the JS variant's own import, and a keyword is a
  // SyntaxError in a `function <name>(` position.
  if (isReservedIdentifier(componentName)) componentName = `Graphic${componentName}`;

  const ctx: RenderContext = { chunks: [] };
  const body = renderSegments(tree.segments, "      ", ctx).join("\n");

  const props = ['assetsPath = "."', 'className = ""'];
  for (const snippet of tree.snippets) props.push(snippet.propName);
  if (tree.bindings.length > 0) props.push("bindings = {}");
  const destructured = `{ ${props.join(", ")} }`;

  const chunkLiterals = ctx.chunks
    .map((chunk) => `  \`${escapeTemplateLiteral(chunk)}\`,`)
    .join("\n");

  const isTypeScript = options?.typescript === true;

  // Lazy `<video>` loader. Chunks are injected with `dangerouslySetInnerHTML`,
  // and a `<script>` set that way is inserted but never executed, so the loader
  // runs as an effect over the component root instead. `safePath` is the
  // dependency because it is what rebuilds the chunks — and therefore replaces
  // the video elements the observer is holding.
  const reactHooks = tree.hasLazyVideo ? "useEffect, useMemo, useRef" : "useMemo";
  const lazyVideoEffect = tree.hasLazyVideo
    ? `
  // Lazy <video> loader. A <script> set via dangerouslySetInnerHTML is inserted
  // but never runs, so this graphic's videos are swapped from data-src to src
  // here instead. safePath is the dependency because it rebuilds the chunks,
  // and with them the video elements.
  useEffect(() => {
    if (rootRef.current) return ${lazyVideoLoaderCall("rootRef.current", "    ")}
  }, [safePath]);
`
    : "";
  const lazyVideoRef = tree.hasLazyVideo
    ? `  const rootRef = useRef${isTypeScript ? "<HTMLDivElement | null>" : ""}(null);\n`
    : "";
  const rootRefAttr = tree.hasLazyVideo ? " ref={rootRef}" : "";
  const propTypes = [
    "  assetsPath?: string;",
    "  className?: string;",
    // The layer name each prop came from is exported as `snippetKeys` below, not
    // written into this comment: `JSON.stringify` does not escape `*/`, so a
    // layer name could close the comment and the rest of it would be parsed as
    // source. See `js-identifier.ts`.
    ...tree.snippets.map(
      (s) => `  /** Snippet placeholder; see snippetKeys. */\n  ${s.propName}?: ReactNode;`,
    ),
  ];
  if (tree.bindings.length > 0) {
    propTypes.push("  /** Tagged text overrides, keyed by binding path. */");
    propTypes.push("  bindings?: Record<string, string>;");
  }

  const typeAnnotation = (annotation: string): string => (isTypeScript ? annotation : "");
  const metadata: string[] = [];
  if (tree.snippets.length > 0) {
    const entries = tree.snippets
      .map((s) => `${jsStringLiteral(s.propName)}: ${jsStringLiteral(s.key)}`)
      .join(", ");
    metadata.push(
      "// Snippet prop name → the design-file layer name it came from.",
      `export const snippetKeys${typeAnnotation(": Record<string, string>")} = { ${entries} };`,
    );
  }
  if (tree.bindings.length > 0) {
    metadata.push(
      "// Every tagged-text path this component accepts in `bindings`.",
      `export const bindingPaths${typeAnnotation(": string[]")} = [${tree.bindings
        .map((b) => jsStringLiteral(b.path))
        .join(", ")}];`,
    );
  }
  const metadataBlock = metadata.length > 0 ? `${metadata.join("\n")}\n` : "";

  const reactTypeImport =
    tree.snippets.length > 0
      ? 'import type { JSX, ReactNode } from "react";'
      : 'import type { JSX } from "react";';

  const header = isTypeScript
    ? `${reactTypeImport}
import { ${reactHooks} } from "react";

interface ${componentName}Props {
${propTypes.join("\n")}
}
`
    : `import React, { ${reactHooks} } from "react";
`;

  const signature = isTypeScript
    ? `export default function ${componentName}(${destructured}: ${componentName}Props): JSX.Element {`
    : `export default function ${componentName}(${destructured}) {`;

  const jsx = `${header}
const ASSET_TOKEN = "${ASSETS_TOKEN}";
const cssText = \`${escapeTemplateLiteral(tree.css)}\`;
const htmlChunks = [
${chunkLiterals}
];
const googleFontsHref = ${tree.googleFontsHref ? JSON.stringify(tree.googleFontsHref) : "null"};
// Inert wrapper: injected markup must not add a box to the artboard's layout.
const CONTENTS = { display: "contents" }${isTypeScript ? " as const" : ""};
${metadataBlock}
${signature}
  const safePath = ${assetBaseJoinRuntimeExpression("assetsPath")};
  const html = useMemo(
    () => htmlChunks.map((chunk) => chunk.split(ASSET_TOKEN).join(safePath)),
    [safePath]
  );
${lazyVideoRef}${lazyVideoEffect}
  return (
    <div className={className}${rootRefAttr}>
      {googleFontsHref ? (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link rel="stylesheet" href={googleFontsHref} />
        </>
      ) : null}
      <style dangerouslySetInnerHTML={{ __html: cssText }} />
${body}
    </div>
  );
}
`;

  return { jsx, warnings: warningMessages(structuredWarnings), structuredWarnings };
}
