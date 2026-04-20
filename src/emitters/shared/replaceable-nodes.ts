import type { ComputedPosition, EmitterReadyDocument } from "../../ir/types.js";

export interface ReplaceableNode {
  type: "snippet" | "binding";
  /** Snippet key → component prop name */
  key?: string;
  /** Binding path, e.g. "headlines.main" */
  bindingPath?: string;
  /** Whether binding allows raw HTML injection */
  allowHtml?: boolean;
  /** Original static text for fallback (binding only) */
  fallbackText?: string;
  /** Computed position for overlay rendering */
  position: ComputedPosition;
  /** Which artboard this belongs to (artboard name) */
  artboardName: string;
  /** Unique element ID for keying */
  elementId: string;
}

/**
 * Extract all replaceable nodes (snippets + bindings) from a document.
 * Used by Svelte and React emitters to render overlay elements.
 *
 * In v1.1, only snippet elements will exist. Binding support
 * activates in v1.2 with zero changes to this function.
 */
function sanitizeId(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export interface ExtractOptions {
  /** When false, all binding.allowHtml is forced to false. Defaults to true. */
  allowUnsafeHtml?: boolean;
}

export function extractReplaceableNodes(
  doc: EmitterReadyDocument,
  options: ExtractOptions = {},
): ReplaceableNode[] {
  const unsafeHtmlAllowed = options.allowUnsafeHtml !== false;
  const nodes: ReplaceableNode[] = [];
  let counter = 0;

  for (const ab of doc.artboards) {
    for (const layer of ab.layers) {
      for (const el of layer.elements) {
        // Snippet elements
        if (el.type === "snippet" && "computedPosition" in el) {
          nodes.push({
            type: "snippet",
            key: el.key,
            position: el.computedPosition,
            artboardName: ab.name,
            elementId: `snippet-${sanitizeId(el.key)}-${sanitizeId(ab.name)}-${counter++}`,
          });
        }

        // Text elements with bindings (v1.2+)
        if (el.type === "text" && "computedPosition" in el && "binding" in el && el.binding) {
          const textEl = el as typeof el & {
            binding: { path: string; allowHtml: boolean };
          };
          // Collect fallback text from paragraphs
          const fallback = textEl.paragraphs.map((p) => p.text).join("\n");
          nodes.push({
            type: "binding",
            bindingPath: textEl.binding.path,
            allowHtml: unsafeHtmlAllowed && textEl.binding.allowHtml,
            fallbackText: fallback,
            position: textEl.computedPosition,
            artboardName: ab.name,
            elementId: `binding-${sanitizeId(textEl.binding.path)}-${sanitizeId(ab.name)}-${counter++}`,
          });
        }
      }
    }
  }

  return nodes;
}

/**
 * Get unique snippet keys from replaceable nodes.
 * Used to generate component prop declarations.
 */
export function getSnippetKeys(nodes: ReplaceableNode[]): string[] {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (node.type === "snippet" && node.key) {
      keys.add(node.key);
    }
  }
  return [...keys].sort();
}
