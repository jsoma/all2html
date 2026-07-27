/**
 * The serializer's contract, specified rather than discovered (SPEC §12.6 / D23).
 *
 * `html.ts` and `html-string.ts` are now one builder plus one serializer, so the
 * old "do the two emitters agree?" question is answered by construction. What
 * still needs asserting is everything that question used to cover implicitly:
 * the escaping grammars, boolean attributes, void elements, raw-text elements,
 * attribute order, comment sanitization, and intentional raw markup.
 *
 * The final block is the real parity anchor that replaces the old one: every IR
 * fixture is rendered through both the shipped serializer and the hast adapter,
 * and the two must be byte-identical. That is what keeps the escaping subsets
 * pinned to `hast-util-to-html`'s own, which is the reason they are as narrow as
 * they are.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toHtml } from "hast-util-to-html";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { buildHTMLTree, emitHTML } from "../../src/emitters/html.js";
import { toCssUrlValue } from "../../src/emitters/shared/assets.js";
import { escapeAttr, escapeHtml } from "../../src/emitters/shared/escape.js";
import {
  comment,
  el,
  type HtmlNode,
  isVoidElement,
  raw,
  serializeHtml,
  text,
} from "../../src/emitters/shared/html-node.js";
import { HAST_TO_HTML_OPTIONS, toHast } from "../../src/emitters/shared/to-hast.js";
import type { EmitterOptions } from "../../src/emitters/types.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function render(...nodes: HtmlNode[]): string {
  return serializeHtml(nodes);
}

describe("attribute and text escaping are different grammars", () => {
  // Both subsets are copied from hast-util-to-html and must not be widened
  // without re-proving parity — `emitter-escaping-parity.test.ts` pins them to
  // hast directly, and the adapter block below pins the serializer to both.
  it("escapes text with the text subset only", () => {
    expect(render(text(`a<b>c&d"e'f\`g`))).toBe(`a&lt;b>c&amp;d"e'f\`g`);
    expect(render(text(`a<b>c&d"e'f\`g`))).toBe(escapeHtml(`a<b>c&d"e'f\`g`));
  });

  it("escapes attribute values with the attribute subset only", () => {
    const value = "a<b>c&d\"e'f`g" + String.fromCharCode(0) + "h i";
    expect(render(el("div", [["title", value]]))).toBe(
      `<div title="a<b>c&amp;d&quot;e&#x27;f&#x60;g&#x0;h i"></div>`,
    );
    expect(render(el("div", [["title", value]]))).toBe(`<div title="${escapeAttr(value)}"></div>`);
  });

  it("does not confuse the two", () => {
    // `<` is escaped in text and not in attributes; `"` is the reverse. A single
    // shared escaper would be wrong in one direction or the other.
    expect(render(text("<"))).toBe("&lt;");
    expect(render(el("div", [["title", "<"]]))).toBe('<div title="<"></div>');
    expect(render(text('"'))).toBe('"');
    expect(render(el("div", [["title", '"']]))).toBe('<div title="&quot;"></div>');
  });

  it("builders never pre-escape: a value is escaped exactly once", () => {
    // Double escaping is the failure mode a builder-side `escapeAttr()` causes.
    expect(render(el("div", [["title", "a&b"]]))).toBe('<div title="a&amp;b"></div>');
    expect(render(text("a&b"))).toBe("a&amp;b");
  });
});

describe("boolean attributes", () => {
  // hast represents these as `true`; the old string emitter spelled them out by
  // hand in a literal. Now `true` is the representation on both paths.
  const BOOLEAN_ATTRIBUTES = ["autoplay", "muted", "loop", "playsinline", "crossorigin"];

  it("emits a bare attribute name for `true`", () => {
    for (const name of BOOLEAN_ATTRIBUTES) {
      expect(render(el("video", [[name, true]]))).toBe(`<video ${name}></video>`);
    }
  });

  it("omits the attribute entirely for false, null and undefined", () => {
    for (const value of [false, null, undefined] as const) {
      expect(render(el("video", [["autoplay", value]]))).toBe("<video></video>");
    }
  });

  it("matches how hast serializes the same tree", () => {
    for (const name of BOOLEAN_ATTRIBUTES) {
      const node = el("video", [[name, true]]);
      expect(toHtml(toHast([node]), HAST_TO_HTML_OPTIONS)).toBe(render(node));
    }
  });

  it("emits the video element exactly as the emitter builds it", () => {
    expect(
      render(
        el("video", [
          ["autoplay", true],
          ["muted", true],
          ["loop", true],
          ["playsinline", true],
          ["src", "a.mp4"],
        ]),
      ),
    ).toBe('<video autoplay muted loop playsinline src="a.mp4"></video>');
  });
});

describe("void elements", () => {
  it("emit no closing tag", () => {
    expect(render(el("img", [["src", "a.png"]]))).toBe('<img src="a.png">');
    expect(render(el("link", [["rel", "stylesheet"]]))).toBe('<link rel="stylesheet">');
    expect(render(el("meta", [["charset", "utf-8"]]))).toBe('<meta charset="utf-8">');
  });

  it("emit no children, because a void element has no content model", () => {
    expect(render(el("img", [["src", "a.png"]], [text("ignored")]))).toBe('<img src="a.png">');
  });

  it("non-void elements always close, even when empty", () => {
    expect(render(el("div"))).toBe("<div></div>");
    expect(render(el("span", [["class", "x"]]))).toBe('<span class="x"></span>');
  });

  it("knows the full HTML void set, not just the three this codebase builds", () => {
    for (const tag of ["area", "base", "br", "col", "embed", "hr", "input", "wbr"]) {
      expect(isVoidElement(tag), tag).toBe(true);
    }
    for (const tag of ["div", "span", "video", "script", "style", "a", "p"]) {
      expect(isVoidElement(tag), tag).toBe(false);
    }
  });
});

describe("raw-text elements", () => {
  // These two neutralizations closed confirmed XSS holes: a `</style>` breakout
  // through font mappings, and the `<!--<script>` document swallow through
  // custom JS blocks. The serializer owns them so no builder can forget.
  it("does not HTML-escape script or style text", () => {
    expect(render(el("style", [], [text("a[b='c'] { content: \"&\" }")]))).toBe(
      "<style>a[b='c'] { content: \"&\" }</style>",
    );
    expect(render(el("script", [], [text("if (a & b) {}")]))).toBe(
      "<script>if (a & b) {}</script>",
    );
  });

  it("neutralizes `</style` and `<!--` inside style", () => {
    const out = render(el("style", [], [text("a{}</style><img src=x onerror=alert(1)>")]));
    expect(out).toBe("<style>a{}<\\/style><img src=x onerror=alert(1)></style>");
    expect(out.match(/<\/style>/g)?.length).toBe(1);
    expect(render(el("style", [], [text("/* <!-- */")]))).toBe("<style>/* <\\!-- */</style>");
  });

  it("neutralizes `</script` and `<!--` inside script", () => {
    const out = render(el("script", [], [text('var p = "</script><img src=x>";')]));
    expect(out.match(/<\/script>/g)?.length).toBe(1);
    expect(out).toContain("<\\/script>");
    expect(render(el("script", [], [text("var q = '<!--<script>';")]))).toBe(
      "<script>var q = '<\\!--<script>';</script>",
    );
  });

  it("applies the neutralization case-insensitively", () => {
    expect(render(el("style", [], [text("a{}</STYLE>")]))).toBe("<style>a{}<\\/STYLE></style>");
    expect(render(el("script", [], [text("a </SCRIPT b")]))).toBe(
      "<script>a <\\/SCRIPT b</script>",
    );
  });

  it("leaves a raw child in a raw-text element verbatim, as the escape hatch", () => {
    expect(render(el("style", [], [raw("a{}")]))).toBe("<style>a{}</style>");
  });
});

describe("deterministic attribute order", () => {
  // The string emitter used to iterate `Object.keys`, whose order ES3 does not
  // define — and ExtendScript's `Object.keys` is a `for...in` polyfill, so the
  // shipped artifact depended on unspecified behavior for byte-identical output.
  it("emits attributes in array order", () => {
    expect(
      render(
        el("div", [
          ["z", "1"],
          ["a", "2"],
          ["m", "3"],
        ]),
      ),
    ).toBe('<div z="1" a="2" m="3"></div>');
  });

  it("keeps order for names an object would have reordered", () => {
    // `Object.keys({ "2": …, "1": … })` returns ["1","2"] — integer-like keys are
    // sorted ahead of everything else. An array of pairs cannot be reordered.
    expect(
      render(
        el("div", [
          ["data-2", "b"],
          ["data-1", "a"],
        ]),
      ),
    ).toBe('<div data-2="b" data-1="a"></div>');
    expect(Object.keys({ 2: "b", 1: "a" })).toEqual(["1", "2"]);
  });

  it("omitted attributes do not disturb the order of the rest", () => {
    expect(
      render(
        el("img", [
          ["class", "a"],
          ["alt", ""],
          ["src", "x.png"],
          ["style", undefined],
        ]),
      ),
    ).toBe('<img class="a" alt="" src="x.png">');
  });

  it("keeps an empty-string value rather than dropping it", () => {
    // `alt=""` and `style=""` are both emitted today; dropping them would change
    // rendered output as well as bytes.
    expect(render(el("div", [["style", ""]]))).toBe('<div style=""></div>');
  });
});

describe("comments", () => {
  it("wraps the body in single spaces", () => {
    expect(render(comment("hello"))).toBe("<!-- hello -->");
  });

  it("breaks every comment-delimiter sequence", () => {
    for (const value of ["a --> b", "a <!-- b", "a --!> b", "<!--->", "-->".repeat(5)]) {
      const out = render(comment(value));
      expect(out.slice(4, -3)).not.toMatch(/<!--|-->|--!>/);
    }
  });

  it("leaves harmless double dashes alone", () => {
    expect(render(comment("card--640"))).toBe("<!-- card--640 -->");
  });
});

describe("intentional raw markup", () => {
  it("passes raw nodes through verbatim", () => {
    expect(render(raw('<aside data-hook="x">hook & <em>raw</em></aside>'))).toBe(
      '<aside data-hook="x">hook & <em>raw</em></aside>',
    );
  });

  it("carries an explicit trust marker so raw output is greppable", () => {
    expect(raw("<b>x</b>").trust).toBe("application");
  });

  it("passes inline SVG through untouched", () => {
    const svg = '<svg viewBox="0 0 1 1"><path d="M0 0 L1 1"/></svg>';
    expect(render(raw(svg))).toBe(svg);
  });

  it("renders nested raw markup inside built elements", () => {
    expect(render(el("p", [], [raw("&nbsp;")]))).toBe("<p>&nbsp;</p>");
  });
});

describe("CSS URL escaping is a separate grammar", () => {
  // D23: this must not be delegated to HTML escaping. `toCssUrlValue` runs
  // first, producing a CSS <url> token; the serializer then attribute-escapes
  // the whole style value like any other attribute.
  it("escapes backslashes and quotes the CSS way, not the HTML way", () => {
    expect(toCssUrlValue('a"b\\c.png')).toBe('url("a\\"b\\\\c.png")');
    // HTML escaping would have produced `&quot;`, which CSS does not decode.
    expect(toCssUrlValue('a"b.png')).not.toContain("&quot;");
  });

  it("layers the two grammars in the right order in a style attribute", () => {
    // CSS escaping adds the backslash; HTML attribute escaping then turns every
    // quote into an entity. Neither substitutes for the other.
    const value = `--img:${toCssUrlValue('a"b.png')}`;
    expect(value).toBe('--img:url("a\\"b.png")');
    expect(render(el("div", [["style", value]]))).toBe(
      '<div style="--img:url(&quot;a\\&quot;b.png&quot;)"></div>',
    );
  });
});

describe("the hast adapter renders the same bytes as the serializer", () => {
  const fixtures = readdirSync(fixturesDir).filter((file) => file.endsWith(".json"));
  const optionSets: (EmitterOptions | undefined)[] = [
    undefined,
    { allowUnsafeHtml: false, positionMode: "percentage" },
    { responsiveImageMode: "css-var" },
  ];

  it("covers every IR fixture", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(32);
  });

  for (const fixture of fixtures) {
    it(fixture, () => {
      const raw = JSON.parse(readFileSync(resolve(fixturesDir, fixture), "utf-8"));
      const { document: doc } = processDocument(raw);
      for (const options of optionSets) {
        const { nodes } = buildHTMLTree(doc, undefined, options);
        const viaHast = toHtml(toHast(nodes), HAST_TO_HTML_OPTIONS);
        expect(viaHast, `${fixture} ${JSON.stringify(options)}`).toBe(
          emitHTML(doc, undefined, options).html,
        );
      }
    });
  }

  it("round-trips the tree through JSON unchanged", () => {
    // The node tree is part of the JSON-serializable model (SPEC §12.2): a
    // consumer may transport it before rendering.
    const raw = JSON.parse(
      readFileSync(resolve(fixturesDir, "escaping-adversarial.json"), "utf-8"),
    );
    const { document: doc } = processDocument(raw);
    const { nodes } = buildHTMLTree(doc);
    expect(serializeHtml(JSON.parse(JSON.stringify(nodes)))).toBe(emitHTML(doc).html);
  });
});
