/**
 * The lazy `<video>` loader, single-sourced for every surface that emits one.
 *
 * `useLazyLoader` is honored for images by the platform — they get native
 * `loading="lazy"` — but there is no native equivalent for `<video>`, so a lazy
 * video is emitted with `data-src` and no `src` and something has to swap them
 * in. Nothing did: the markup shipped, the video never played, and both HTML
 * emitters warned per video layer instead (`video:lazy-src-no-loader`).
 *
 * The loader below is that missing piece. It is one source string with the DOM
 * root parameterized, because the three vehicles differ:
 *
 *   - **html / standalone** — a `<script>` element in the emitted tree, rooted
 *     at `document`. It is a normal `text` child of the element, so the
 *     serializer's `escapeScriptContent()` applies to it like any other script
 *     content; it is deliberately not a `raw()` node.
 *   - **svelte / react** — markup ships through `{@html}` /
 *     `dangerouslySetInnerHTML`, and a `<script>` inserted that way never
 *     executes. Those emitters call the same source from `$effect` / `useEffect`
 *     with the component root, which is also the only vehicle that re-runs when
 *     the framework rebuilds the injected markup.
 *
 * Scoping is by root plus the `video[data-src]` selector, never by document id:
 * the id carries a user-controlled slug and this is a JavaScript source
 * position, so embedding it would put arbitrary text one quote away from
 * executable code. Two graphics on one page each emit their own loader, and
 * double-processing is unrepresentable — the selector stops matching a video the
 * moment its `data-src` is consumed.
 *
 * ES3-safe: this module ships inside the ExtendScript bundle. The *emitted*
 * source is ES5 for the same reason any embed is — it runs in whatever browser
 * the CMS page loads in.
 */

/** The selector the emitted loader queries. Exported so tests can find it. */
export const LAZY_VIDEO_SELECTOR = "video[data-src]";

/**
 * Marks the loader `<script>` in the node tree.
 *
 * The tree is the *HTML document*, so `buildHTMLTree()` puts the script in it
 * unconditionally when a lazy video was emitted. The framework emitters lift it
 * back out by this attribute — the same way `component-tree.ts` lifts the
 * stylesheet — because a `<script>` inside an `{@html}` chunk is dead markup,
 * and they re-emit the loader as a lifecycle effect instead.
 */
export const LAZY_VIDEO_SCRIPT_ATTR = "data-all2html";
export const LAZY_VIDEO_SCRIPT_ATTR_VALUE = "lazy-video-loader";

/**
 * The loader as a self-contained function expression taking the DOM root.
 *
 * Contains no `</script` and no `<!--`, so `escapeScriptContent()` passes it
 * through unchanged — `test/unit/lazy-video-loader.test.ts` asserts that rather
 * than assuming it.
 */
export function lazyVideoLoaderFunction(): string {
  return [
    // Returns a teardown on every path, so a framework effect can hand the
    // return value straight back as its cleanup. An observer that outlives its
    // component keeps every element it observes alive.
    "function (root) {",
    '  var videos = root.querySelectorAll("' + LAZY_VIDEO_SELECTOR + '");',
    "  function teardown() {}",
    "  if (videos.length === 0) return teardown;",
    "  function load(video) {",
    '    var src = video.getAttribute("data-src");',
    "    if (!src) return;",
    '    video.removeAttribute("data-src");',
    '    video.setAttribute("src", src);',
    '    if (typeof video.load === "function") video.load();',
    "  }",
    // No IntersectionObserver (old browsers, and any renderer without a
    // viewport): load everything now. A video that never plays is a worse
    // failure than one that loads early.
    //
    // Written as `!== "function"` rather than `=== "undefined"` on purpose: the
    // golden-IR smoke test asserts the emitted HTML contains no `undefined`,
    // which is a real check on a real class of emitter bug, and a loader that
    // put the word in every page carrying a video would have retired it.
    '  if (typeof IntersectionObserver !== "function") {',
    "    for (var i = 0; i < videos.length; i++) load(videos[i]);",
    "    return teardown;",
    "  }",
    "  var observer = new IntersectionObserver(function (entries) {",
    "    for (var j = 0; j < entries.length; j++) {",
    "      if (!entries[j].isIntersecting) continue;",
    "      observer.unobserve(entries[j].target);",
    "      load(entries[j].target);",
    "    }",
    '  }, { rootMargin: "200px 0px" });',
    "  for (var k = 0; k < videos.length; k++) observer.observe(videos[k]);",
    "  return function () {",
    "    observer.disconnect();",
    "  };",
    "}",
  ].join("\n");
}

/**
 * The loader as a statement that runs it against `rootExpression`.
 *
 * `rootExpression` is emitter-authored source (`document`, `rootEl`,
 * `rootRef.current`) — never user text. `indent` is prefixed to every line after
 * the first, so the statement can be dropped inside a generated component body
 * without wrecking its shape.
 */
export function lazyVideoLoaderCall(rootExpression: string, indent?: string): string {
  const statement = "(" + lazyVideoLoaderFunction() + ")(" + rootExpression + ");";
  if (!indent) return statement;
  return statement.split("\n").join("\n" + indent);
}

/** The document-level loader for the html and standalone `<script>` element. */
export function lazyVideoLoaderScript(): string {
  return "\n" + lazyVideoLoaderCall("document") + "\n";
}
