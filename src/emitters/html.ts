/**
 * The HTML emitter entry point used by every surface — the CLI, the browser
 * apps, Figma, and the ExtendScript bundle.
 *
 * There is only one HTML emitter (SPEC §12.6 / D23): `html-tree.ts` builds a
 * serializable node tree and `shared/html-node.ts` renders it. The historical
 * second name for this call, `html-string.ts` / `emitHTMLString`, was an alias
 * onto the same function and has been deleted.
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
