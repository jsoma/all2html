/**
 * The HTML emitter entry point used by the CLI, the browser apps and Figma.
 *
 * There is only one HTML emitter now (SPEC §12.6 / D23): `html-tree.ts` builds a
 * serializable node tree and `shared/html-node.ts` renders it. This module and
 * `html-string.ts` are the two historical names for the same call, kept because
 * `html-string.ts` is what the ExtendScript bundle imports and this is what
 * everything else imports.
 *
 * Consumers who want the tree rather than a string take `buildHTMLTree()` here.
 * `toHast()` in `shared/to-hast.js` adapts the same tree for rehype, but it is
 * in-repo only — it is not re-exported from `src/index.ts` and has no `exports`
 * entry, so it is not reachable from the published package.
 */

export {
  buildHTMLTree,
  type EmitGroupOptions,
  type EmitHTMLResult,
  type EmitHTMLTreeResult,
  emitHTMLDocument as emitHTML,
} from "./html-tree.js";
