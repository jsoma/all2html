import { readdirSync } from "node:fs";

/**
 * Every IR fixture, for the framework-emitter compile tests.
 *
 * Both `svelte-emitter-compile.test.ts` and `react-emitter-compile.test.ts` read
 * this list. They used to keep their own: React's included
 * `escaping-adversarial.json`, Svelte's hand-picked list did not — and the
 * Svelte emitter had been hard-failing the real compiler on that fixture, in all
 * four option sets, with `css_global_block_invalid_declaration`. A shared,
 * directory-derived list means neither emitter can be checked against a smaller
 * corpus than the other, and a new fixture is covered the moment it lands.
 */
export const COMPONENT_FIXTURES: string[] = readdirSync("test/fixtures/ir")
  .filter((name) => name.endsWith(".json"))
  .sort();

/**
 * The default option set. Every fixture is compiled under this one.
 *
 * The Svelte `:global` failure reproduced in *all four* option sets, so the
 * fixture axis is what found it and the option axis added nothing — 32 × 4 × 2
 * reported one bug 256 times. The fixture axis stays whole; the option axis is
 * swept only over the fixtures below.
 */
export const COMPONENT_DEFAULT_OPTIONS = { label: "defaults", options: undefined } as const;

/** The emitter option sets swept over `COMPONENT_STRUCTURAL_FIXTURES`. */
export const COMPONENT_EMITTER_OPTIONS = [
  { label: "allowUnsafeHtml: false", options: { allowUnsafeHtml: false } },
  { label: "positionMode: percentage", options: { positionMode: "percentage" as const } },
  { label: "responsiveImageMode: css-var", options: { responsiveImageMode: "css-var" as const } },
];

/**
 * Fixtures that differ *structurally* — each one puts a different kind of node
 * on the spine that the framework emitters have to build as real JSX / Svelte
 * markup rather than hand off as one opaque innerHTML chunk. Those are the
 * shapes an emitter option can plausibly break; a second fixture with the same
 * shape and different text cannot fail where the first passes.
 *
 * Chosen from the whole corpus by structure, not by count:
 *  - `escaping-adversarial`  every layer type, both custom-block kinds, snippets,
 *                            bindings, hyperlinks, fonts, assets, multi-artboard
 *  - `snippet-layer`         snippets become real props / `{@render}`
 *  - `tagged-text`           bindings — the `allowUnsafeHtml` axis
 *  - `multi-artboard-responsive`  breakpoints + assets — the `positionMode` and
 *                            `responsiveImageMode` axes
 *  - `custom-blocks`         css / js / html-before / html-after passthrough
 *  - `svg-layer-inline`      inline `<svg>` on the spine
 *  - `png-layer-overlay`     image-only layer (no text)
 *  - `video-layer`           `<video>` element attributes
 *  - `div-layer`             replaceable div node
 */
export const COMPONENT_STRUCTURAL_FIXTURES = [
  "escaping-adversarial.json",
  "snippet-layer.json",
  "tagged-text.json",
  "multi-artboard-responsive.json",
  "custom-blocks.json",
  "svg-layer-inline.json",
  "png-layer-overlay.json",
  "video-layer.json",
  "div-layer.json",
];
