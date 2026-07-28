/**
 * The After Effects exporter has the ExtendScript bundle slot (D13), so the
 * helpers it used to hand-copy from the core are gone. Two things have to stay
 * true, and neither is self-evident from reading either file alone:
 *
 *  1. **The forks stay retired.** `exporter.jsx` must define no Google Fonts or
 *     escaping helper of its own. `escape-single-source.test.ts` covers the
 *     `escape*Html|Attr|Xml*` family by name; nothing covered the ~185 lines of
 *     google-fonts ES5, which is the larger half of what drifted.
 *  2. **The shipped artifact actually carries the bundle.** A build script that
 *     silently stopped concatenating it would leave `requireCore()` failing at
 *     runtime inside After Effects, where nobody in CI would see it.
 *
 * The behavior assertions run against the *built* bundle rather than the
 * TypeScript source, because the bundle is what After Effects evaluates and
 * because rollup's module ordering is itself a hazard here: dependency module
 * bodies execute before `installPolyfills()`, so an array method at module
 * scope would throw in the host while passing every Node test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureFreshArtifact, repoRoot } from "../helpers/extendscript-build.js";

// Function-property syntax, not method syntax: `escape-single-source.test.ts`
// scans for `escapeAttr(` at a line start and would report these as forks.
interface AeCore {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
  escapeInlineJson: (json: string) => string;
  googleFontsUrl: (fonts: unknown[]) => string;
  googleFontsLinkTags: (fonts: unknown[]) => { rel: string; href: string; crossorigin?: boolean }[];
}

let core: AeCore;
let bundleSource = "";

beforeAll(() => {
  const path = ensureFreshArtifact("dist/extendscript/all2html-ae-core.js", "build:illustrator");
  bundleSource = readFileSync(path, "utf-8");
  const context = createContext({});
  runInContext(bundleSource, context);
  core = (context as { All2HtmlAE: AeCore }).All2HtmlAE;
}, 180_000);

const exporterSource = readFileSync(join(repoRoot, "plugins/after-effects/exporter.jsx"), "utf-8");

describe("After Effects loads the shared helpers instead of forking them", () => {
  it("defines no Google Fonts helper of its own", () => {
    // The names the deleted fork used, plus the shapes a re-fork would take.
    const forkMarkers = [
      /function\s+buildGoogleFontsUrl\s*\(/,
      /function\s+isSkippedGoogleFontFamily\s*\(/,
      /function\s+normalizeGoogleFontWeight\s*\(/,
      /function\s+encodeGoogleFontFamily\s*\(/,
      /function\s+getPrimaryCssFamily\s*\(/,
      /function\s+stripWrappingQuotes\s*\(/,
      /fonts\.googleapis\.com\/css2/,
    ];
    const found = forkMarkers.filter((pattern) => pattern.test(exporterSource)).map(String);
    expect(found).toEqual([]);
  });

  it("defines no escaping helper of its own", () => {
    expect(exporterSource).not.toMatch(/function\s+escapeHtmlAttr\s*\(/);
    expect(exporterSource).not.toMatch(/function\s+escapeInlineJson\s*\(/);
  });

  it("calls the bundle for every helper it lost", () => {
    expect(exporterSource).toMatch(/\.escapeAttr\(/);
    expect(exporterSource).toMatch(/\.escapeInlineJson\(/);
    expect(exporterSource).toMatch(/\.googleFontsUrl\(/);
    expect(exporterSource).toMatch(/\.googleFontsLinkTags\(/);
  });

  it("emits the same <link> markup the shared renderer does", () => {
    // `data-all2html-google-fonts="true"` existed so the Svelte and React
    // emitters could regex the link tags back out of serialized HTML. Since the
    // one-emitter collapse (D23) they consume the node tree and never build the
    // links, so nothing has read it; it left the emitters earlier and survived
    // here only to keep AE output byte-identical through the bundle-slot
    // migration. The only difference from `renderGoogleFontsLinkTags` that is
    // left is the newline join.
    expect(exporterSource).not.toContain('data-all2html-google-fonts="true"');
    expect(exporterSource).toContain("'<link rel=\"'");
    // The player root marker is a different attribute and must stay.
    expect(
      readFileSync(join(repoRoot, "plugins/after-effects/player-template.html"), "utf-8"),
    ).toContain("data-all2html-ae");
  });

  it("fails loudly when the bundle is absent instead of throwing a ReferenceError", () => {
    expect(exporterSource).toMatch(/typeof All2HtmlAE !== "undefined"/);
    expect(exporterSource).toMatch(/function requireCore\(\)/);
  });

  it("ships the bundle inside the artifact After Effects evaluates", () => {
    const assembled = readFileSync(
      ensureFreshArtifact("plugins/illustrator/panel/dist/cep/jsx/all2html-ae.jsx", "build:panel"),
      "utf-8",
    );
    expect(assembled).toContain("var All2HtmlAE = (function");
    // The bundle must come first: it installs the ES5 polyfills the exporter
    // then runs under, and defines the helpers the exporter calls.
    expect(assembled.indexOf("var All2HtmlAE = (function")).toBeLessThan(
      assembled.indexOf("function requireCore()"),
    );
    expect(assembled).toContain("installPolyfills();");
  }, 180_000);

  it("installs the polyfills before any module-scope code needs them", () => {
    // Rollup emits dependency bodies first, so `installPolyfills()` is not the
    // first statement — what matters is that nothing before it calls an ES5
    // array/string method. `new Function` would hide this; a real evaluation
    // with the methods deleted is the only honest check.
    const stripped = `
      var deleted = [];
      var proto = Array.prototype;
      var names = ["map", "filter", "forEach", "indexOf", "includes", "find", "findIndex"];
      for (var i = 0; i < names.length; i++) {
        if (proto[names[i]]) { deleted.push([proto, names[i], proto[names[i]]]); delete proto[names[i]]; }
      }
      if (String.prototype.trim) { deleted.push([String.prototype, "trim", String.prototype.trim]); delete String.prototype.trim; }
      if (Number.isNaN) { deleted.push([Number, "isNaN", Number.isNaN]); delete Number.isNaN; }
      try { ${bundleSource} } finally {
        for (var j = 0; j < deleted.length; j++) { deleted[j][0][deleted[j][1]] = deleted[j][2]; }
      }
    `;
    const context = createContext({});
    expect(() => runInContext(stripped, context)).not.toThrow();
    const installed = (context as { All2HtmlAE: AeCore }).All2HtmlAE;
    // ...and the polyfills it installed are enough to run the helpers.
    expect(installed.googleFontsUrl([{ family: "Roboto", weight: "700" }])).toContain("Roboto");
  });
});

describe("the shared helpers behave as the retired forks did", () => {
  it("builds the same Google Fonts URL", () => {
    expect(
      core.googleFontsUrl([
        { family: "Playfair Display", weight: "bold" },
        { family: "Playfair Display", weight: "400", style: "italic" },
      ]),
    ).toBe(
      "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,400&display=swap",
    );
    // System families are skipped, so a document that maps only those requests
    // nothing at all — the empty string the exporter branches on.
    expect(core.googleFontsUrl([{ family: "Arial" }, { family: "Helvetica Neue" }])).toBe("");
    expect(core.googleFontsUrl([])).toBe("");
  });

  it("returns the three link tags the player template splices", () => {
    const tags = core.googleFontsLinkTags([{ family: "Roboto" }]);
    expect(tags.map((tag) => tag.rel)).toEqual(["preconnect", "preconnect", "stylesheet"]);
    expect(tags[1].crossorigin).toBe(true);
    expect(tags[2].href).toContain("family=Roboto");
    expect(core.googleFontsLinkTags([{ family: "Arial" }])).toEqual([]);
  });

  it("escapes the model JSON for an inline script, including the line terminators", () => {
    // Every `<` goes, not just `</`: `<!--<script>` is what opens the
    // script-data-double-escaped state, and there is no end-tag-open sequence
    // left once `<` itself cannot appear.
    expect(core.escapeInlineJson('{"a":"</script>"}')).toBe('{"a":"\\u003c/script>"}');
    expect(core.escapeInlineJson('{"a":"<!--<script>"}')).toBe('{"a":"\\u003c!--\\u003cscript>"}');
    // ...and U+2028/U+2029 are ES5 line terminators that JSON.stringify leaves
    // raw, which is a SyntaxError in the exported page. This is why the AE
    // grammar is not `escapeScriptContent`.
    const lineSeparators = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
    expect(core.escapeInlineJson(`{"a":"${lineSeparators}"}`)).toBe('{"a":"\\u2028\\u2029"}');
    // `&` and `>` are not in script data's grammar, so they stay legible.
    expect(core.escapeInlineJson('{"a":"plain & b>"}')).toBe('{"a":"plain & b>"}');
    // The escape is JSON syntax, so the parsed value is byte-identical.
    expect(JSON.parse(core.escapeInlineJson(JSON.stringify({ a: "<!--<script>" })))).toEqual({
      a: "<!--<script>",
    });
  });

  /**
   * The escaping rule is only worth what a real HTML tokenizer says about it, so
   * this splices the model into the real player template exactly as
   * `buildHtml()` in `plugins/after-effects/exporter.jsx` does and parses the
   * result.
   *
   * The payload is `<!--<script>`, which is the specific string that used to
   * break it: `</` was neutralized, but a bare `<` was not, so the tokenizer
   * entered script-data-double-escaped inside the `application/json` element
   * and consumed the template's own `</script>` as text. Both scripts collapsed
   * into one and the entire player was swallowed into the JSON element — the
   * export "succeeded" and the graphic was dead.
   */
  describe("the emitted player HTML, parsed", () => {
    const template = readFileSync(
      join(repoRoot, "plugins/after-effects/player-template.html"),
      "utf-8",
    );
    const model = { layers: { title: { text: "<!--<script>" } } };

    function scriptsFor(json: string): HTMLScriptElement[] {
      // `replaceFirstLiteral` in the exporter; the arrow keeps `$&` in the JSON
      // from being read as a replacement pattern.
      const html = template.replace("__MODEL_JSON__", () => json);
      const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
      return Array.from(dom.window.document.querySelectorAll("script"));
    }

    it("leaves the player script intact and the model still JSON.parse-able", () => {
      const scripts = scriptsFor(core.escapeInlineJson(JSON.stringify(model, null, 2)));
      expect(scripts).toHaveLength(2);
      expect(scripts[0].getAttribute("data-ae-role")).toBe("model");
      expect(JSON.parse(scripts[0].textContent ?? "")).toEqual(model);
      // The player is its own element and still carries its code, rather than
      // sitting inside the JSON element as text.
      expect(scripts[0].textContent).not.toContain("root.all2htmlAE");
      expect(scripts[1].textContent).toContain("root.all2htmlAE");
    });

    it("would fail under the retired `</`-only rule", () => {
      // Not decoration: without this the test above passes against any escaping
      // at all, including none, because a benign payload never enters the
      // escaped states.
      const naive = JSON.stringify(model, null, 2).replace(/<\//g, "<\\/");
      const scripts = scriptsFor(naive);
      expect(scripts).toHaveLength(1);
      expect(scripts[0].textContent).toContain("root.all2htmlAE");
      expect(() => JSON.parse(scripts[0].textContent ?? "")).toThrow();
    });
  });

  it("escapes the font href with the attribute grammar, not the text grammar", () => {
    // The exporter substitutes into a double-quoted attribute, so the quote and
    // the apostrophe must go and `<`/`>` need not. Swapping in `escapeHtml`
    // here would leave `"` live and break out of the attribute.
    expect(core.escapeAttr('a"b')).toBe("a&quot;b");
    expect(core.escapeAttr("a'b")).toBe("a&#x27;b");
    expect(core.escapeHtml('a"b')).toBe('a"b');
  });
});
