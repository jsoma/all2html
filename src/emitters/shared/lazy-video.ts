/**
 * The one warning both HTML emitters must raise identically.
 *
 * `useLazyLoader` is honored for images — they get native `loading="lazy"` —
 * but a video is emitted with `data-src` and no `src`, and no surface emits a
 * loader script (zero hits for `IntersectionObserver` / `lazyload` /
 * `loadImages` anywhere in `src/`), so the video never plays. That is a
 * property of the *document*, not of the settings, which is why
 * `src/core/capabilities.ts` defers it here instead of warning on every export
 * that leaves the setting at its default.
 *
 * Single-sourced because `html.ts` and `html-string.ts` must stay identical;
 * duplicating the string is exactly how `escapeAttr` drifted four ways.
 *
 * ES3-safe: this module ships inside the ExtendScript bundle.
 */

import { createWarning, type StructuredWarning } from "../../core/warnings.js";

/** Stable code for "lazy video markup was emitted but nothing will load it". */
export const LAZY_VIDEO_NO_LOADER_CODE = "video:lazy-src-no-loader";

export function lazyVideoWarning(
  layerName: string,
  context: { artboardId: string; layerId: string },
): StructuredWarning {
  return createWarning(
    LAZY_VIDEO_NO_LOADER_CODE,
    "markup",
    'Layer "' +
      layerName +
      '" emits a lazy <video> with data-src and no src, and no loader script is emitted, so the video never plays. Set useLazyLoader: false to emit a direct src.',
    { artboardId: context.artboardId, layerId: context.layerId, setting: "useLazyLoader" },
  );
}
