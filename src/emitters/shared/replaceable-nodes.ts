/**
 * The framework emitters' view of the HTML node tree (SPEC §12.6 / D23 / D8).
 *
 * `html-tree.ts` marks the two kinds of element a component developer is meant
 * to fill in — snippet placeholders (`data-replaceable="snippet"`) and bound
 * text (`data-replaceable="binding"`). This module is how Svelte and React find
 * them: **structurally, in the tree**, never by searching serialized HTML.
 *
 * Why the tree and not the document: the markers already exist in the tree at
 * the exact position the placeholder occupies, inside the artboard that owns
 * it. An earlier version of this module walked the `EmitterReadyDocument`
 * instead and returned `{ position, artboardName }` for the emitters to render
 * as absolutely-positioned *overlays*. That could not work — artboard
 * visibility is decided by `@container` queries on `#{ns}{slug}-box`, so an
 * overlay rendered outside the artboard has no way to know which artboard is
 * showing, and the percentage positions are relative to the artboard box. The
 * replacement has to happen where the placeholder is, which means splitting the
 * tree there. That is what `segmentTree()` does.
 *
 * `segmentTree()` reconstructs *only the spine* — the chain of ancestors
 * leading to a replaceable node. Everything else stays a single opaque markup
 * chunk, which keeps author-written `html-before` / `html-after` blocks and
 * inline SVG out of the framework compilers' hands.
 *
 * Node-only: not part of the ExtendScript bundle.
 */

import type { HtmlElementNode, HtmlNode } from "./html-node.js";
import { safeIdentifier, sanitizeIdentifier, uniqueIdentifier } from "./js-identifier.js";

/** A snippet placeholder. Becomes a Svelte snippet prop / React `ReactNode` prop. */
export interface SnippetMarker {
  type: "snippet";
  /** Author-facing key, from the design-tool layer name. */
  key: string;
  /**
   * `key` as a JS identifier — the generated component's prop name.
   *
   * `readReplaceableMarker` fills this with the per-key name; the final,
   * document-unique name is assigned by `collectReplaceables`, which is the only
   * place that can see every key at once. Emitters must therefore render
   * segments *after* calling it (`buildComponentTree` does).
   */
  propName: string;
}

/** A bound text element. Becomes an entry in the component's `bindings` prop. */
export interface BindingMarker {
  type: "binding";
  /** Dotted binding path, e.g. `headlines.main`. */
  path: string;
  /** Already gated by the `allowUnsafeHtml` emitter option upstream. */
  allowHtml: boolean;
  /**
   * Class of the first fallback paragraph. The bound value is re-wrapped in a
   * `<p>` carrying it, so replacing the text does not drop its type styles.
   */
  paragraphClassName: string | null;
}

export type ReplaceableMarker = SnippetMarker | BindingMarker;

/**
 * A run of the tree, classified by whether it has to be reconstructed natively.
 *
 * - `markup` — no replaceable inside. Serialized once and injected verbatim
 *   (`{@html}` / `dangerouslySetInnerHTML`).
 * - `host` — an ancestor of a replaceable. Emitted as a real framework element
 *   so its children can be real framework children.
 * - `replaceable` — the placeholder itself. `fallback` is its original content,
 *   used when no value is supplied for a binding.
 */
export type ComponentSegment =
  | { kind: "markup"; nodes: HtmlNode[] }
  | { kind: "host"; node: HtmlElementNode; children: ComponentSegment[] }
  | {
      kind: "replaceable";
      node: HtmlElementNode;
      marker: ReplaceableMarker;
      fallback: HtmlNode[];
    };

export function getAttr(node: HtmlElementNode, name: string): string | null {
  for (const [attrName, value] of node.attrs) {
    if (attrName !== name) continue;
    if (typeof value === "string") return value;
    return null;
  }
  return null;
}

/**
 * A snippet key is a layer name, so it can be anything. Sanitize deterministically
 * (Appendix A: "sanitized to valid JS identifiers"), keep clear of every JS/TS
 * reserved word and of every identifier the generated components declare
 * themselves — see `js-identifier.ts` for why both halves matter.
 *
 * This is the name for *one* key in isolation. Uniqueness within a document is
 * `collectReplaceables`' job.
 */
export function snippetPropName(key: string): string {
  return safeIdentifier(key);
}

function firstParagraphClassName(children: HtmlNode[]): string | null {
  for (const child of children) {
    if (child.kind === "element" && child.tag === "p") return getAttr(child, "class");
  }
  return null;
}

/** Read the `data-replaceable` marker off an element, if it carries one. */
export function readReplaceableMarker(node: HtmlNode): ReplaceableMarker | null {
  if (node.kind !== "element") return null;
  const kind = getAttr(node, "data-replaceable");
  if (kind === "snippet") {
    const key = getAttr(node, "data-key");
    if (key === null) return null;
    return { type: "snippet", key, propName: snippetPropName(key) };
  }
  if (kind === "binding") {
    const path = getAttr(node, "data-binding-path");
    if (path === null) return null;
    return {
      type: "binding",
      path,
      allowHtml: getAttr(node, "data-binding-html") === "true",
      paragraphClassName: firstParagraphClassName(node.children),
    };
  }
  return null;
}

/** Whether this node is, or contains, a replaceable placeholder. */
export function containsReplaceable(node: HtmlNode): boolean {
  if (node.kind !== "element") return false;
  if (readReplaceableMarker(node)) return true;
  for (const child of node.children) {
    if (containsReplaceable(child)) return true;
  }
  return false;
}

/**
 * Split a sibling list into opaque markup runs plus the spine down to every
 * replaceable placeholder. A document with no snippets and no bindings yields
 * exactly one `markup` segment, which is why the common case is unchanged.
 */
export function segmentTree(nodes: HtmlNode[]): ComponentSegment[] {
  const segments: ComponentSegment[] = [];
  let buffer: HtmlNode[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    segments.push({ kind: "markup", nodes: buffer });
    buffer = [];
  };

  for (const node of nodes) {
    const marker = readReplaceableMarker(node);
    if (marker && node.kind === "element") {
      flush();
      segments.push({ kind: "replaceable", node, marker, fallback: node.children });
      continue;
    }
    if (node.kind === "element" && containsReplaceable(node)) {
      flush();
      segments.push({ kind: "host", node, children: segmentTree(node.children) });
      continue;
    }
    buffer.push(node);
  }
  flush();

  return segments;
}

/** A snippet key whose prop name had to be changed, and what it became. */
export interface PropNameRename {
  key: string;
  propName: string;
  /**
   * - `reserved` — the sanitized name is a keyword, or an identifier the
   *   generated component already declares.
   * - `collision` — another key had already taken that name.
   */
  reason: "reserved" | "collision";
}

export interface CollectedReplaceables {
  /** Unique by prop name, sorted — the component's snippet props. */
  snippets: SnippetMarker[];
  /** Unique by path, sorted — the keys of the `bindings` prop. */
  bindings: BindingMarker[];
  /**
   * Keys whose prop name is not the plain sanitization of the key. Renaming is
   * always safe (it is deterministic and every placeholder for a key gets the
   * same name), but it is invisible to the author, so the emitters warn.
   */
  propNameRenames: PropNameRename[];
}

/**
 * Collect the component's snippet/binding surface **and assign the final prop
 * names**.
 *
 * Names have to be assigned here rather than in `readReplaceableMarker` because
 * only this pass sees every key in the document: a name has to dodge the
 * reserved set *and* every other key's name. Assignment walks the tree in
 * document order, so it is deterministic; markers are updated in place, which is
 * what the emitters read when they render the segments they were handed.
 */
export function collectReplaceables(segments: ComponentSegment[]): CollectedReplaceables {
  const markersByKey = new Map<string, SnippetMarker[]>();
  const keyOrder: string[] = [];
  const bindingsByPath = new Map<string, BindingMarker>();

  const walk = (list: ComponentSegment[]): void => {
    for (const segment of list) {
      if (segment.kind === "host") {
        walk(segment.children);
        continue;
      }
      if (segment.kind !== "replaceable") continue;
      const marker = segment.marker;
      if (marker.type === "snippet") {
        const existing = markersByKey.get(marker.key);
        if (existing) existing.push(marker);
        else {
          markersByKey.set(marker.key, [marker]);
          keyOrder.push(marker.key);
        }
      } else if (!bindingsByPath.has(marker.path)) {
        bindingsByPath.set(marker.path, marker);
      }
    }
  };
  walk(segments);

  const taken: { [name: string]: true } = {};
  const snippets: SnippetMarker[] = [];
  const propNameRenames: PropNameRename[] = [];

  for (const key of keyOrder) {
    const markers = markersByKey.get(key) ?? [];
    const base = sanitizeIdentifier(key);
    const propName = uniqueIdentifier(base, taken);
    for (const marker of markers) marker.propName = propName;
    snippets.push(markers[0]);
    if (propName !== base) {
      propNameRenames.push({
        key,
        propName,
        reason: propName === safeIdentifier(key) ? "reserved" : "collision",
      });
    }
  }

  return {
    snippets: snippets.sort((a, b) => a.propName.localeCompare(b.propName)),
    bindings: [...bindingsByPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    propNameRenames,
  };
}
