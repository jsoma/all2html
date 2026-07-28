# Emitters

Emitters take an `EmitterReadyDocument` and produce output in a specific format.

## Registry (`registry.ts`)

Emitters live in a fixed internal `Map` seeded with the built-ins at construction. There is no runtime registration — `registerEmitter` was deleted with zero call sites, and the table exports no mutators. Each descriptor has `emitAll(doc, groups)` returning `{ files: EmitFile[], warnings, structuredWarnings }`. Emitters build `StructuredWarning[]` internally (code + category assigned at the call site, see `src/core/warnings.ts`); `warnings` is the plain-string projection kept for the manifest and the surface UIs. The CLI uses `getEmitter(format)` for dispatch — no if/else chain. The `perGroup()` helper handles the group loop for **every** emitter, standalone included (`registry-shared.ts#perGroup`) — standalone used to discard `groups` and emit one file whatever `output` said, which is the bug that made `output: multiple-files` a lie on that format. Extensions go through `resolveOutputExtension()` in `src/core/output-extension.ts` (leading dot ensured, anything that is not a filename suffix rejected with `setting:invalid-value` and replaced by the default) — the extension is a filename component, and "add a dot if missing" turned `/../../outside.txt` into a path that resolved above `-o`. Only the html emitter reads `htmlOutputExtension` — svelte/react force `.svelte` and `.jsx`/`.tsx`, and standalone hardcodes `.html`. `formatDictatedExtension(format, emitterConfig)` is the single statement of that per-format rule; callers pass its result as `SurfaceContext.formatExtension` so the capability checker compares a requested extension against the one file name the run will actually write.
Common emitter options must be wired end-to-end through the registry; don't leave typed options as dead config. `assetBase` is the one option a **surface** supplies rather than a user: `withAssetBase()` in `types.ts` stamps it onto every format at the one point that knows where the surface writes its files, and it is deliberately absent from the strict `EmitterConfigSchema` so a config file naming it is a parse error.

## HTML emitter (`html-tree.ts` + `shared/html-node.ts`)

There is ONE HTML emitter (SPEC §12.6 / D23). `html-tree.ts` builds a tree of plain,
JSON-serializable nodes; `shared/html-node.ts` defines those nodes and holds the single
ES3-safe serializer. `html.ts` is the one thin re-export entry point onto that call —
every surface, the ExtendScript bundle included, imports `emitHTML` (the `html-string.ts`
/ `emitHTMLString` alias was deleted).

Do not reintroduce a second implementation. The two used to be ~1,050 lines with an
identical function decomposition kept in sync by test alone, and they had already
silently diverged on four fields.

**The serializer owns all escaping. Builders pass RAW values and never pre-escape.**
There is no `escapeAttr`/`escapeHtml` call in `html-tree.ts` and there must not be one —
pre-escaping would double-escape at emit time. The serializer picks the grammar from the
node's position in the tree: text nodes, attribute values, comments, and `script`/`style`
raw text are four different grammars (see the escaping contract below).

Node shape:

```ts
type HtmlNode =
  | { kind: "element"; tag: string; attrs: [string, string | boolean | null | undefined][]; children: HtmlNode[] }
  | { kind: "text"; value: string }
  | { kind: "raw"; value: string; trust: "application" }
  | { kind: "comment"; value: string };
```

- **Attributes are an ordered array of pairs, not an object.** The old string emitter
  depended on `Object.keys` insertion order, which ES3 does not define — and
  ExtendScript's `Object.keys` is a `for...in` polyfill, so the shipped artifact relied on
  unspecified behavior. Order is now a property of the data.
- `undefined` / `null` / `false` values omit the attribute; `true` emits a bare boolean
  attribute (`autoplay`, `muted`, `loop`, `playsinline`, `crossorigin`).
- Void elements (`img`, `link`, `meta`, and the rest of the HTML void set) emit no closing
  tag and drop children.
- `script` and `style` are raw-text elements: their `text` children are *not* HTML-escaped;
  they go through `escapeScriptContent()` / `escapeStyleContent()` instead.
- `raw` nodes are the one escape hatch — custom blocks, inline SVG layers, html-hook
  layers, and `&nbsp;`. `trust: "application"` keeps every such site greppable.
- CSS URLs are a *fifth* grammar and are NOT delegated to HTML escaping: `toCssUrlValue()`
  runs first, then the result is attribute-escaped like any other value.

Renders all element types: TextElement, ShapeElement (symbols/divs), VideoElement,
RawHtmlElement, SVG layers, PNG layers. Supports multi-file output via `EmitGroupOptions`
(subset of artboards + slug override).

`buildHTMLTree()` is exported for consumers that want the tree rather than a string.

## hast adapter (`shared/to-hast.ts`)

`toHast(nodes)` converts the tree to hast. Nothing in this repo consumes it at runtime —
the emitters use their own serializer, which is what ships into ExtendScript — and it is
**not a published extension point**: `src/index.ts` does not re-export it and `exports` has
no entry for it, so only in-repo code (and anyone vendoring `src/`) can call it. Exporting
it would also mean moving `@types/hast` into `dependencies`, because the emitted `.d.ts`
names `Root`. Its live job is the parity anchor: `test/unit/html-serializer.test.ts`
renders every IR fixture through both paths and asserts byte equality, which is what keeps
the escaping subsets pinned to `hast-util-to-html`'s own.

`hast` types are imported type-only; no hast runtime package enters `src/` any more.

## Framework emitters (`svelte.ts`, `react.ts`)

Both consume the **node tree**, not serialized HTML (SPEC §12.6 / D23). `shared/component-tree.ts`
is the shared entry: it builds the tree, takes the `<style>` element out of it as a node,
suppresses the Google Fonts `<link>` tags at build time rather than stripping them afterwards,
and splits what is left at replaceable placeholders. Nothing regexes emitted HTML, and comments —
including comments an author wrote in an `html-before` / `html-after` block — are left alone.

Snippets and bindings are real component surface, not markers:

- **Svelte** — snippet placeholders become Svelte 5 snippet props rendered with `{@render key?.()}`;
  bound text becomes `{#if bindings["path"] != null}…{:else}{@html …fallback}{/if}`.
- **React** — snippet placeholders become `ReactNode` props rendered as `{key}`; bound text uses the
  same `bindings` prop, with `dangerouslySetInnerHTML` only when `allowHtml` survived `allowUnsafeHtml`.

Only the **spine** — the ancestors leading down to a placeholder — is emitted as real framework
markup. Everything else stays one opaque chunk, so a document with no snippets and no bindings still
produces exactly one `{@html}` / `dangerouslySetInnerHTML` call. React chunk wrappers carry
`display: contents` so they add no box to the artboard's layout; the generated CSS uses only
descendant combinators, so an inert wrapper is invisible to it.

React's static markup is deliberately **not** converted to JSX. See SPEC §12.6 for what a full JSX
emitter would need — the blocker is `raw` nodes (custom blocks, html-hook layers, inline SVG), which
would require an HTML parser and SVG attribute camelCasing in a path that has neither.

The Svelte `<style>` is wrapped in `:global { … }`: markup ships through `{@html}`, which the Svelte
compiler cannot see into, so an unwrapped block is pruned as unused selectors and the component loses
its entire stylesheet including the `@container` rules. That block accepts **rules only**, so the
stylesheet goes through `shared/css-rule-list.ts` first — a custom `css` block with a bare
declaration, a stray `}` or an unclosed rule is otherwise a hard compile error in the *generated*
component. Malformed items are dropped (unclosed rules are closed), with an
`emit:css-not-rule-list` warning naming the custom block. Only Svelte does this: HTML and React
inject CSS where the browser's own error recovery applies.

`test/unit/svelte-emitter-compile.test.ts` and `test/unit/react-emitter-compile.test.ts` both drive
`test/fixtures/component-fixtures.ts` — every IR fixture × every option set. Do not hand-pick a
fixture list in either: the two lists diverged once, and the Svelte emitter was failing to compile
`escaping-adversarial.json` in all four option sets while React's list covered it.

### Identifiers in generated components

Layer names and binding paths are user text that becomes JavaScript source, so both emitters route
every identifier through `shared/js-identifier.ts` and every piece of user text through
`jsStringLiteral()`.

- **No user text in a comment, ever.** `JSON.stringify` escapes neither `*/` (React's `/** … */`
  prop docs) nor a newline (Svelte's `//` prop docs), so a layer name could close the comment and
  execute. Keys and paths are emitted as string literals in a data position instead —
  `snippetKeys` / `bindingPaths`, exported from the module (Svelte: `<script module>`).
- `jsStringLiteral()` also escapes `<` and U+2028/U+2029: a Svelte `<script>` is still an HTML
  script element, so `</script>` inside a JS string closes it.
- The reserved set is the **union** across both emitters — JS/TS keywords plus every identifier the
  generated components declare (`cssText`, `htmlChunks`, `googleFontsHref`, `CONTENTS`, `useMemo`,
  `React`, `JSX`, `ReactNode`, `resolveHtml`, `ASSET_TOKEN`, `snippetKeys`, `bindingPaths`, …) — so
  one key yields one prop name in both. **Add to `GENERATED_IDENTIFIERS` whenever you declare a new
  identifier in either emitter**; a miss there is a silent shadow, not a compile error.
- Names are made unique per document in `collectReplaceables()`, in document order, and any rename
  warns (`emit:snippet-prop-renamed`) naming the layer and the chosen name.
- Leading `$` is rewritten: Svelte rejects every `$`-prefixed binding.

`test/unit/component-identifier-safety.test.ts` compiles each case with the real Svelte compiler and
esbuild, then *executes* the module in a `node:vm` sandbox to prove nothing a layer name contains
runs.

## Standalone emitter (`standalone.ts`)

Full HTML document. Supports `local_preview_template` setting via the template system.

`applyTemplate` returns `{ output, warnings }`. Those warnings must reach the emitter's
result: a slot the template system refused (attribute name, tag name, unquoted attribute
value, `script`/`style` raw text) is left unsubstituted, and `emit:template-unsafe-slot`
is the only signal the author gets that their template has an unsafe placeholder in it.
The emitter passes `{ setting: "localPreviewTemplate" }` as the warning context, because
`src/core/template.ts` does not know which setting the file came from.

Two entry points, on purpose:

- `emitStandalone(doc, options?)` — the **public**, root-exported call. Its second parameter is
  `EmitterOptions` and must stay that way. A JavaScript caller writing
  `emitStandalone(doc, { allowUnsafeHtml: false })` gets no type error when a parameter is
  inserted in front of its options object; the object is silently read as something else and
  every option is dropped, including that one. That regression shipped once.
- `emitStandaloneGroup(doc, groupOptions?, options?)` — internal, group-aware, what the registry
  calls. `standalone-browser.ts` mirrors the pair (`emitStandaloneBrowser` /
  `emitStandaloneBrowserGroup`). Never discriminate the two objects by shape — the named function
  is the whole point.

Neither browser entry point warns about `localPreviewTemplate`. The capability checker
(`src/core/capabilities.ts`) owns that warning: it fires once per document and knows the real
surface, whereas the emitter fired once per output group and hardcoded `surface: "browser"` even
on a Figma export, which shares this emitter.

## Shared utilities (`shared/`)

- `css.ts` — All CSS generation. Container queries, artboard styles (with `aspect-ratio` for dynamic), text style classes. Scoped to `#{ns}{slug}-box`.
- `escape.ts` — **the** escaping module: `escapeHtml()`, `escapeAttr()`, `sanitizeCommentText()`, `renderComment()`, `escapeScriptContent()`, `escapeStyleContent()`, plus the `isSafeUrl()` href scheme allowlist and its `unsafeUrlWarning()` text. No other copy of these may exist. Only `html-node.ts` (the serializer) calls the escapers — emitters do not.
- `html-node.ts` — the node types, the `el()`/`text()`/`raw()`/`comment()` builders and `serializeHtml()`. ES3-safe.
- `to-hast.ts` — `toHast()` adapter plus `HAST_TO_HTML_OPTIONS`. Node-only, in-repo only, one caller (the parity test).
- `assets.ts` — Asset indexing by canonical `artboardId`/`layerId`, `resolveAssetPath()` and `toCssUrlValue()`. `resolveAssetPath()` reads `settings.imageSourcePath` (the user's `<img src>` prefix, used verbatim) and the `assetBase` emitter option (the surface's layout: where it writes assets relative to the emitted file). It must never read `imageOutputPath` — that is where the *files* go, which equals the `src` prefix only on surfaces that emit into the root of that layout. `asset.path` itself is spelled by `artifactRelativePath()` from `src/core/artifact-path.js`, the same constructor `createOutputBundle()` builds its entry from, so a valid-but-unusual `Asset.path` (`/x.png`, `a//b.png`) cannot make the emitted `src` and the ZIP entry disagree. There is no `%%ASSET_PATH%%` token: `tokenizedAssetPath()` / `replaceAssetPathToken()` were deleted with zero call sites — the Svelte/React emitters use `ASSETS_TOKEN` in `shared/component-tree.ts`.
- `options.ts` — Applies shared emitter options (`allowUnsafeHtml`, `positionMode`) before rendering.
- `replaceable-nodes.ts` — Finds snippet/binding placeholders **in the node tree** by their
  `data-replaceable` marker, and `segmentTree()` splits a sibling list into opaque markup runs plus
  the spine down to each placeholder. Also owns `snippetPropName()` (layer name → JS identifier) and
  the per-document prop-name assignment in `collectReplaceables()`.
- `js-identifier.ts` — layer name → safe JS identifier (`sanitizeIdentifier`, `safeIdentifier`,
  `uniqueIdentifier`, the reserved set) and user text → safe JS string literal (`jsStringLiteral`).
  Node-only.
- `css-rule-list.ts` — `toRuleList()` / `isRuleList()`: reduce a stylesheet to something a rule-list
  context (Svelte's `:global { … }`) accepts, reporting what was dropped. Node-only.
- `component-tree.ts` — The shared Svelte/React input: builds the tree, lifts the stylesheet out of
  it, carries the Google Fonts href separately, segments the rest, and collects the snippet/binding
  props. Owns `ASSETS_TOKEN` and `escapeTemplateLiteral()`.

## Svelte/React emitter rules

- Consume `buildComponentTree()`. Do not call the HTML emitter for a string and take it apart
- Asset paths use `__ALL2HTML_ASSETS__` token in the HTML string, replaced at runtime
- Do NOT convert `class` → `className` in HTML strings (they're plain HTML inside dangerouslySetInnerHTML).
  Do convert it on the spine, where the element is real JSX
- Strip trailing slashes from `assetsPath` before replacement to avoid double-slash paths
- Component names must be valid JS identifiers (prefix with "Graphic" if slug starts with a digit)
- Token regex must cover `src`, `data-src`, and video extensions (mp4, webm) not just images
- Do not strip comments. Author comments in `html-before` / `html-after` blocks are content
- Neither emitter may be imported from anything in the ExtendScript entry graph

## Escaping contract

There is exactly ONE contract, defined in `shared/escape.ts` and applied in exactly one
place — the serializer in `shared/html-node.ts`. It is **hast's own escaping subset**:
`hast-util-to-html` offers no way to widen what it escapes, so the serializer escapes
exactly what hast escapes — no more, no less — and the `toHast()` adapter round-trips
byte-identically as proof.

- text content (`escapeHtml`) → `&` and `<` only
- double-quoted attribute values (`escapeAttr`) → NUL, `"`, `&`, `'`, backtick
- comments → `sanitizeCommentText()` breaks `<!--` / `-->` / `--!>` **before** the value
  reaches hast, so hast's own comment encoder never fires and both paths agree
- inline `<script>` → `escapeScriptContent()` backslash-escapes `</script` (provably inert
  in every JS context, since a bare `/` would already have ended a regex literal) and, when
  the content contains `<!--`, **appends `\n-->`**. It no longer rewrites `<!--` itself:
  in Unicode mode neither `<\!--` nor `<!\--` parses, so the old rewrite turned a valid
  author regex like `/<!--/u` into a SyntaxError, and telling the corrupting case apart
  needs a real JS lexer in a module that ships to ExtendScript. Containment does not
  require removing `<!--`, only that the tokenizer be back in *script data* when the
  serializer writes its own `</script>` — and LF `-` `-` `>` returns there from
  script-data-escaped, double-escaped, and both dash states. The appended text is inert JS
  (`SingleLineHTMLCloseComment`, Annex B), which is unavailable in *module* code; every
  script these emitters produce is a classic `type="text/javascript"` script.
- inline `<style>` → `escapeStyleContent()` rewrites `</style` and `<!--`. Applied by the
  serializer to any `text` child of a `style` element, so it cannot be forgotten.

Both subsets are still sufficient: `>`/`"` cannot start a tag in text, and `<`/`>`
cannot terminate a double-quoted attribute. Narrowing (rather than widening) is what
makes byte-identical output possible.

Escaping alone cannot make a URL safe, so `href` values (text-run hyperlinks and
`settings.clickableLink`) go through `isSafeUrl()` instead: `http`, `https`, `mailto`,
`tel`, fragments and relative URLs are allowed, and anything else drops the anchor
with a warning naming the URL. The check strips ASCII whitespace and C0 controls
first, because browsers do (`java\tscript:` and `\njavascript:` are otherwise live).

Defense in depth lives in the core too: `compute-styles.ts` validates `fontFamily`
against the CSS `<family-name>` grammar (and `fontWeight`/`fontStyle` against a
keyword grammar) so font mappings from `all2html.config.json`, document XMP or the
panel font editor cannot reach the stylesheet as raw text. Rejected values warn,
naming the font, and fall back — they are never silently dropped.

Emitters pass RAW values everywhere. `escapeAttr()`/`escapeHtml()` are called by the
serializer and by nothing else in the emitter path.

`test/unit/emitter-escaping-parity.test.ts` + `test/fixtures/ir/escaping-adversarial.json`
pin this down: every string-typed IR field carries `< > & " ' --> <!-- --!> </script`,
and behavior is asserted across `{grouped, ungrouped}` × the full option cross-product.
The style, script and href defenses are additionally asserted structurally with
`jsdom`, so a payload has to actually escape its container to pass.
`test/unit/html-serializer.test.ts` specifies the serializer itself — the two escaping
grammars, boolean attributes, void elements, raw-text elements, attribute order, comment
sanitization, raw markup, and the separate CSS-URL grammar — and asserts serializer/hast
byte equality over every IR fixture.

## Rules

- The HTML emitter passes RAW values into the node tree and never escapes. Escaping is the serializer's job and happens exactly once
- Outside the node tree (e.g. `standalone-shared.ts`), use `escapeAttr()` for attribute values and `escapeHtml()` for text content
- Never define a local `escapeAttr`/`escapeHtml`/`escapeHtmlAttr` — import from `shared/escape.ts`
- Never add a second HTML emitter. `html.ts` is the one entry point onto `html-tree.ts`; do not reintroduce an alias module
- CSS properties output in alphabetical order for determinism
- Use `raw()` only for intentionally unescaped content (custom blocks, inline SVG, `&nbsp;`)
- Pre-index assets with `buildScopedAssetIndex()` for O(1) canonical ID lookups — don't use `Object.values().find()` in loops
- Grouped output must use the same effective slug for DOM IDs and generated CSS selectors
- Shape elements use `EmitterReadyShapeElement` type — no `as any`
- Narrow elements with `el.type` and `el.renderAs` only. `EmitterReadyLayer.elements` contains no un-positioned variants, so `"computedPosition" in el` / `"computedShapePosition" in el` probes are never needed and must not come back
- Artboard names in HTML comments are sanitized by the serializer's `comment` handling — pass the raw name
