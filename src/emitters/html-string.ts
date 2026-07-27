/**
 * The HTML emitter entry point used by the ExtendScript bundle.
 *
 * Historically this was a second, string-concatenating reimplementation of
 * `html.ts`, kept byte-identical by test alone. Both are now names for the same
 * builder + serializer (SPEC §12.6 / D23), so the divergence class is gone by
 * construction. The name survives because `src/extendscript/index.ts` and the
 * public API export it, and because it documents which side of the boundary the
 * Illustrator path enters through.
 */

export {
  type EmitGroupOptions,
  type EmitHTMLResult,
  emitHTMLDocument as emitHTMLString,
} from "./html-tree.js";
