/**
 * ExtendScript bundle entry point for the **After Effects** exporter.
 *
 * Why a second entry rather than `index.ts`
 * -----------------------------------------
 * `index.ts` is the IR pipeline: its one exported entry point pulls in Zod-free
 * settings resolution, every transform, the capability checker and the HTML emitter —
 * 115 KB of ES5. After Effects does not construct IR (D13: `exporter.jsx`
 * contains zero occurrences of `irVersion` or `artboards`), so none of that is
 * reachable from it. What AE actually needed from the core was *helpers*, and
 * it had hand-copied them: ~180 lines of google-fonts URL building and a local
 * HTML attribute escaper. That is the fork the "No forked helpers between
 * exporters and core" rule exists to stop, and D13 named exactly this trade —
 * "give AE the bundle slot" — as the ~90%-of-the-benefit, zero-contract-churn
 * alternative to inventing a temporal scene type.
 *
 * So this entry exports the helpers and nothing else. It is deliberately not a
 * path to the pipeline: After Effects still runs neither the pipeline nor the
 * capability checker, and its declaration stays `runtimeChecked: false`.
 *
 * Module evaluation order
 * -----------------------
 * Rollup emits dependency module bodies *before* this module's body, so
 * `installPolyfills()` has not run while `escape.ts` and `google-fonts.ts` are
 * evaluating. Neither calls an array/string method at module scope (only
 * literals), which is what keeps that safe — keep it that way for anything
 * added here.
 */

import { escapeAttr, escapeHtml } from "../emitters/shared/escape.js";
import {
  buildGoogleFontsUrl,
  type GoogleFontLinkTag,
  getGoogleFontsLinkTags,
} from "../emitters/shared/google-fonts.js";
import type { FontMapping } from "../ir/types.js";
import { installPolyfills } from "./polyfills.js";

// Install polyfills on load. `google-fonts.ts` uses Array.prototype.map/indexOf,
// String.prototype.trim and Number.isNaN, none of which ExtendScript's ES3
// runtime has.
installPolyfills();

export type { FontMapping, GoogleFontLinkTag };

/**
 * Escape a JSON payload for splicing into an inline `<script>` element.
 *
 * This is a *third* grammar, distinct from both helpers in
 * `emitters/shared/escape.ts`, which is why it lives here rather than being a
 * call to one of them:
 *
 *   - `escapeHtml()` (text nodes) would HTML-escape `&` and `<`, corrupting the
 *     JSON the player parses.
 *   - `escapeScriptContent()` neutralizes `</script` and `<!--`, but leaves
 *     U+2028/U+2029 alone. Those are ES5 line terminators, `JSON.stringify`
 *     does not escape them, and either one inside an overlay string is a
 *     SyntaxError in the exported page.
 *
 * The `</` rule is broader than `</script` on purpose: a backslash there is
 * inert inside a JSON string literal, and blanket-escaping it means no
 * end-tag-open sequence of any kind survives into script data.
 */
export function escapeInlineJson(json: string): string {
  return String(json)
    .replace(/<\//g, "<\\/")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * The Google Fonts stylesheet URL for a set of font mappings, or `""` when no
 * mapping names a family worth requesting.
 *
 * Wrapped rather than re-exported because the core returns `null` for "nothing
 * to request" and the After Effects exporter branches on a falsy string.
 */
export function googleFontsUrl(fonts: readonly FontMapping[]): string {
  return buildGoogleFontsUrl(fonts) || "";
}

/**
 * The `<link>` tags for `googleFonts: "link"`, as data.
 *
 * The After Effects player template splices its own markup (it still carries
 * the `data-all2html-google-fonts` marker the static emitters dropped, and it
 * joins with newlines), so this hands back the tags rather than a string.
 */
export function googleFontsLinkTags(fonts: readonly FontMapping[]): GoogleFontLinkTag[] {
  return getGoogleFontsLinkTags(fonts);
}

export { escapeAttr, escapeHtml };
