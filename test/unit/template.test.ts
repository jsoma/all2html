import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { applyTemplate, rawTemplateValue } from "../../src/core/template.js";

/** The suite reads `output` constantly; keep the call sites short. */
function render(template: string, vars: Record<string, string> = {}): string {
  return applyTemplate(template, vars).output;
}

describe("applyTemplate", () => {
  const vars = {
    headline: "Breaking News",
    credit: "By Staff",
    projectName: "test-project",
  };

  it("replaces Mustache variables", () => {
    expect(render("{{headline}}", vars)).toBe("Breaking News");
    expect(render("{{{headline}}}", vars)).toBe("Breaking News");
  });

  it("replaces EJS variables", () => {
    expect(render("<%= headline %>", vars)).toBe("Breaking News");
    expect(render("<%- headline %>", vars)).toBe("Breaking News");
  });

  it("is case-insensitive", () => {
    expect(render("{{Headline}}", vars)).toBe("Breaking News");
    expect(render("{{HEADLINE}}", vars)).toBe("Breaking News");
  });

  it("leaves unmatched variables as-is, and does not call that a security event", () => {
    const { output, warnings } = applyTemplate("{{unknown}}", vars);
    expect(output).toBe("{{unknown}}");
    expect(warnings).toEqual([]);
  });

  it("handles multiple variables in one string", () => {
    expect(render("{{headline}} - {{credit}}", vars)).toBe("Breaking News - By Staff");
  });

  it("handles mixed Mustache and EJS", () => {
    expect(render("{{headline}} / <%= credit %>", vars)).toBe("Breaking News / By Staff");
  });

  it("returns a template with no placeholders unchanged, byte for byte", () => {
    const template =
      '<!doctype html>\n<html><head><title>x</title></head>\n<body>&amp; <div id="a">hi</div></body></html>\n';
    const { output, warnings } = applyTemplate(template, vars);
    expect(output).toBe(template);
    expect(warnings).toEqual([]);
  });

  it("leaves a value with nothing to escape byte-identical", () => {
    expect(render("{{projectName}}", vars)).toBe("test-project");
  });
});

/**
 * Substituted values used to be spliced in verbatim, so a `headline` carrying
 * markup became live markup in a `localPreviewTemplate` render.
 *
 * The fix after that was a single context-independent escape table — the union
 * of every position's terminators. Three separate holes were then demonstrated
 * in it, and each has a test below:
 *
 *  1. the table omitted CR, which the HTML parser normalizes to LF *after*
 *     substitution, re-creating the attribute separator the table removed;
 *  2. attribute-*name* position cannot be fixed by escaping a value;
 *  3. raw-text position (`<script>`, `<style>`) cannot be fixed by escaping at
 *     all, because the JS/CSS parser never decodes character references.
 *
 * So the escape is now chosen by an HTML tokenizer run over the template, and
 * the positions no escape can rescue are refused outright.
 */
describe("applyTemplate: position-aware escaping", () => {
  const payload = `<img src=x onerror=alert(1)>`;

  it("escapes markup in a text-position value", () => {
    // The text grammar needs `&` and `<`; `>` cannot start a tag, so it is left
    // alone (this is `escapeHtml`'s subset, shared with the HTML serializer).
    expect(render("<h1>{{headline}}</h1>", { headline: payload })).toBe(
      "<h1>&lt;img src=x onerror=alert(1)></h1>",
    );
    const doc = new JSDOM(render("<h1>{{headline}}</h1>", { headline: payload })).window.document;
    expect(doc.querySelector("h1")?.textContent).toBe(payload);
    expect(doc.querySelectorAll("img")).toHaveLength(0);
  });

  it("escapes a value in a double-quoted attribute so it cannot close it", () => {
    const result = render('<meta content="{{headline}}">', { headline: `" onload="alert(1)` });
    expect(result).toBe('<meta content="&quot; onload=&quot;alert(1)">');

    const meta = new JSDOM(result).window.document.querySelector("meta");
    expect(meta?.getAttribute("content")).toBe(`" onload="alert(1)`);
    expect(meta?.hasAttribute("onload")).toBe(false);
  });

  it("escapes a value in a single-quoted attribute too", () => {
    const result = render("<p title='{{headline}}'>x</p>", { headline: "it's" });
    expect(result).toBe("<p title='it&#x27;s'>x</p>");
    expect(new JSDOM(result).window.document.querySelector("p")?.title).toBe("it's");
  });

  it("renders an ampersand as itself, not double-escaped", () => {
    expect(render("<p>{{credit}}</p>", { credit: "Smith & Sons" })).toBe("<p>Smith &amp; Sons</p>");
    const p = render("<p>{{credit}}</p>", { credit: "Smith & Sons" });
    expect(new JSDOM(p).window.document.querySelector("p")?.textContent).toBe("Smith & Sons");
  });

  it("keeps a quoted-attribute slot safe even when an earlier attribute contains `>`", () => {
    // The heuristic this replaced scanned backwards for the nearest `<`/`>` and
    // read this as "outside a tag". A forward tokenizer has seen the quotes.
    const result = render('<div title="a > b" data-x="{{h}}">y</div>', {
      h: `" onclick="alert(1)`,
    });
    const div = new JSDOM(result).window.document.querySelector("div");
    expect(div?.getAttribute("data-x")).toBe(`" onclick="alert(1)`);
    expect(div?.hasAttribute("onclick")).toBe(false);
  });
});

/**
 * Positions where no value escape can be sufficient. Each is refused: the
 * placeholder is left in the output verbatim (so the emitted bytes are a subset
 * of the author's own template bytes) and a structured warning is raised.
 */
describe("applyTemplate: unsafe positions are rejected", () => {
  function expectRejected(template: string, vars: Record<string, string>, position: RegExp) {
    const { output, warnings } = applyTemplate(template, vars);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("emit:template-unsafe-slot");
    expect(warnings[0].category).toBe("template");
    expect(warnings[0].message).toMatch(position);
    return output;
  }

  /**
   * The reviewer's repro. CR was deliberately left out of the old escape table
   * on the grounds that the HTML parser normalizes CR to LF before tokenizing —
   * true, but the normalization happens *after* substitution, so a raw CR
   * survived the escape and became the very separator the table was removing.
   * Verified live: this produced a working `onmouseover` handler in JSDOM.
   */
  it("rejects an unquoted attribute value, closing the CR hole", () => {
    const output = expectRejected(
      "<div data-t={{h}}>x</div>",
      { h: "x\ronmouseover=alert(1)" },
      /unquoted attribute value/,
    );
    expect(output).toBe("<div data-t={{h}}>x</div>");

    const div = new JSDOM(output).window.document.querySelector("div");
    expect(div?.hasAttribute("onmouseover")).toBe(false);
    expect(div?.attributes).toHaveLength(1);
    expect(output).not.toContain("\r");
  });

  it("rejects a slot in attribute-name position", () => {
    const output = expectRejected(
      "<div {{h}}>x</div>",
      { h: "id=x onclick=alert(1)" },
      /attribute name/,
    );
    const div = new JSDOM(output).window.document.querySelector("div");
    expect(div?.hasAttribute("onclick")).toBe(false);
    expect(div?.hasAttribute("id")).toBe(false);
    expect(div?.attributes).toHaveLength(1); // the literal `{{h}}` attribute
  });

  /**
   * The tokenizer is technically still in *text* state at this offset — `<{` is
   * "invalid first character of tag name" and reverts to text. But that rule
   * reads the character after the `<`, and here that character comes from the
   * *value*: `<` + `div onload=…` is a real tag, and the text escape (`&` and
   * `<` only) leaves every byte of it intact. So the offset immediately after a
   * bare `<` is classified as tag-name position.
   */
  it("rejects a slot in tag-name position", () => {
    const output = expectRejected("<{{h}}>x</div>", { h: "div onload=alert(1)" }, /tag name/);
    expect(output).toBe("<{{h}}>x</div>");
    expect(output).not.toContain("onload");
    expect(new JSDOM(output).window.document.querySelector("[onload]")).toBeNull();
  });

  it("rejects a slot in end-tag-name position", () => {
    const output = expectRejected(
      "<div>x</{{h}}>",
      { h: "div><script>alert(1)</script" },
      /tag name/,
    );
    expect(new JSDOM(output).window.document.querySelectorAll("script")).toHaveLength(0);
  });

  /**
   * `<!-->` and `<!--->` are valid *empty* comments, so a value at the very
   * first offset of a comment body can close it and turn the author's remaining
   * comment text into live markup. There is no escape inside a comment, so that
   * one offset is refused; a single space before the slot makes it safe.
   */
  it("rejects a slot at the very start of a comment body", () => {
    const output = expectRejected(
      "<!--{{h}}<script>alert(1)</script>-->",
      { h: ">" },
      /first position of an HTML comment/,
    );
    expect(new JSDOM(output).window.document.querySelectorAll("script")).toHaveLength(0);
  });

  /**
   * The JS parser does not decode character references, so `&lt;` is four
   * literal characters to it and `&#39;` does not close a string. Escaping is
   * not merely insufficient here — it does nothing at all.
   */
  it("rejects a slot inside <script>", () => {
    const output = expectRejected(
      "<script>var t = '{{h}}';</script>",
      { h: "';alert(1);var x='" },
      /<script> raw text/,
    );
    expect(output).toBe("<script>var t = '{{h}}';</script>");
    expect(output).not.toContain("alert(1)");
  });

  it("rejects a slot inside <style>", () => {
    const output = expectRejected(
      "<style>.a { content: '{{h}}'; }</style>",
      { h: "'} body { background: url(javascript:alert(1)) } .b{'" },
      /<style> raw text/,
    );
    expect(output).toContain("{{h}}");
    expect(output).not.toContain("javascript:");
  });

  it("returns to a safe context after the raw-text element closes", () => {
    const { output, warnings } = applyTemplate("<script>var a=1;</script><p>{{h}}</p>", {
      h: "<b>hi</b>",
    });
    expect(warnings).toEqual([]);
    expect(output).toBe("<script>var a=1;</script><p>&lt;b>hi&lt;/b></p>");
  });

  it("stays rejecting when a raw-text element is never closed", () => {
    // Fail closed: an unterminated <script> leaves every later slot unsafe.
    const { warnings } = applyTemplate("<script>var a = 1;<p>{{h}}</p>", { h: "x" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/<script> raw text/);
  });

  it("names the placeholder and its line in the warning", () => {
    const { warnings } = applyTemplate("<html>\n<body>\n<div {{headline}}>\n", {
      headline: "x",
    });
    expect(warnings[0].message).toContain("{{headline}}");
    expect(warnings[0].message).toContain("line 3");
  });

  it("passes the caller's warning context through", () => {
    const { warnings } = applyTemplate(
      "<div {{h}}>",
      { h: "x" },
      { setting: "localPreviewTemplate" },
    );
    expect(warnings[0].setting).toBe("localPreviewTemplate");
  });

  it("does not warn for an unknown variable in an unsafe position", () => {
    // Nothing was substituted, so there is nothing to report.
    const { output, warnings } = applyTemplate("<div {{nope}}>", { h: "x" });
    expect(output).toBe("<div {{nope}}>");
    expect(warnings).toEqual([]);
  });
});

/** Positions where escaping IS sufficient, and is applied in that grammar. */
describe("applyTemplate: RCDATA and comment positions", () => {
  it("escapes into <title>, where character references still decode", () => {
    const { output, warnings } = applyTemplate("<title>{{h}}</title>", {
      h: "</title><script>alert(1)</script>",
    });
    expect(warnings).toEqual([]);
    const doc = new JSDOM(output).window.document;
    expect(doc.title).toBe("</title><script>alert(1)</script>");
    expect(doc.querySelectorAll("script")).toHaveLength(0);
  });

  it("sanitizes a comment slot so a value cannot close the comment", () => {
    const { output, warnings } = applyTemplate("<!-- note: {{h}} --><p>after</p>", {
      h: "--><script>alert(1)</script><!--",
    });
    expect(warnings).toEqual([]);
    const doc = new JSDOM(output).window.document;
    expect(doc.querySelectorAll("script")).toHaveLength(0);
    expect(doc.querySelector("p")?.textContent).toBe("after");
  });
});

describe("applyTemplate: the raw markup slot", () => {
  const fragment = '<div id="g-chart">&amp; on we go</div>';

  it("substitutes a rawTemplateValue verbatim in text position", () => {
    const { output, warnings } = applyTemplate("{{partial}}", {
      partial: rawTemplateValue(fragment),
    });
    expect(output).toBe(fragment);
    expect(warnings).toEqual([]);
  });

  it("substitutes a rawTemplateValue verbatim inside a real document body", () => {
    const template = "<html><body>\n{{ai2htmlPartial}}\n</body></html>";
    const { output, warnings } = applyTemplate(template, {
      ai2htmlPartial: rawTemplateValue(fragment),
    });
    expect(output).toBe(`<html><body>\n${fragment}\n</body></html>`);
    expect(warnings).toEqual([]);
  });

  it("refuses a raw value outside markup position — markup in an attribute is still wrong", () => {
    const { output, warnings } = applyTemplate('<div data-x="{{partial}}">', {
      partial: rawTemplateValue(fragment),
    });
    expect(output).toBe('<div data-x="{{partial}}">');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("emit:template-unsafe-slot");
  });

  it("never rescans substituted content, so a value cannot smuggle in a second slot", () => {
    const { output } = applyTemplate("{{partial}}", {
      partial: rawTemplateValue("<%= secret %>"),
      secret: "leaked",
    });
    expect(output).toBe("<%= secret %>");
  });

  it("does not let a substituted value steer the tokenizer for later slots", () => {
    // The value closes a tag and opens a <script>; the slot after it must still
    // be classified from the *template's* structure, which says text position.
    const { output, warnings } = applyTemplate("<p>{{a}}</p><p>{{b}}</p>", {
      a: "<script>",
      b: "x",
    });
    expect(warnings).toEqual([]);
    expect(output).toBe("<p>&lt;script></p><p>x</p>");
  });
});

/**
 * The cross-product sweep. Every test above pins one behavior; this one asserts
 * the property that matters — for *any* template position and *any* payload, the
 * rendered document gains no scriptable element and no event handler.
 *
 * A test that only proves output exists proves nothing, so this parses each
 * result with JSDOM and inspects the tree.
 */
describe("applyTemplate: adversarial sweep", () => {
  const TEMPLATES = [
    "<h1>SLOT</h1>",
    "<title>SLOT</title>",
    "<textarea>SLOT</textarea>",
    '<div data-x="SLOT">y</div>',
    "<div data-x='SLOT'>y</div>",
    "<div data-x=SLOT>y</div>",
    "<div SLOT>y</div>",
    "<div data-a=1 SLOT>y</div>",
    '<div title="a > b" data-x=SLOT>y</div>',
    "<SLOT>y</div>",
    "<div>y</SLOT>",
    "<script>var a = 'SLOT';</script>",
    "<style>.a { content: 'SLOT'; }</style>",
    "<!-- SLOT --><p>after</p>",
    "<!--SLOT--><p>after</p>",
    "<!doctype SLOT><p>after</p>",
    "<div/SLOT>y</div>",
    '<div data-x="a"SLOT>y</div>',
    "<p>a &SLOT; b</p>",
  ];

  const PAYLOADS = [
    "x\ronmouseover=alert(1)",
    "x\tonmouseover=alert(1)",
    "x\nonmouseover=alert(1)",
    "x\fonmouseover=alert(1)",
    "x onmouseover=alert(1)",
    '"><img src=x onerror=alert(1)>',
    "'><img src=x onerror=alert(1)>",
    "</script><img src=x onerror=alert(1)>",
    "</style><img src=x onerror=alert(1)>",
    "--><img src=x onerror=alert(1)><!--",
    "><img src=x onerror=alert(1)>",
    "img src=x onerror=alert(1)",
    "div onload=alert(1)",
    "</title><img src=x onerror=alert(1)>",
    "</textarea><img src=x onerror=alert(1)>",
    "lt;img src=x onerror=alert(1)gt;",
  ];

  // One JSDOM instance reused across the whole matrix: constructing ~300 of
  // them is slow enough to trip the default 5s test timeout under load, and the
  // fragment parser runs the same tokenizer.
  const arena = new JSDOM("<!doctype html><html><body></body></html>").window.document;

  interface Parsed {
    /** The tag names the parser finds, in document order. */
    shape: string;
    /** Every attribute name that appeared, lowercased. */
    attrs: string[];
    /** Text the parser handed to a raw-text element. */
    rawText: string;
  }

  function parse(html: string): Parsed {
    arena.body.innerHTML = html;
    const elements = Array.from(arena.body.querySelectorAll("*"));
    const attrs: string[] = [];
    let rawText = "";
    for (const el of elements) {
      for (const attr of Array.from(el.attributes)) attrs.push(attr.name.toLowerCase());
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE") rawText += el.textContent ?? "";
    }
    return { shape: elements.map((el) => el.tagName).join(","), attrs: attrs, rawText: rawText };
  }

  it("never lets a value add an element or an event handler", () => {
    for (const shape of TEMPLATES) {
      const template = shape.replace("SLOT", "{{h}}");
      // The element structure a harmless value produces is the reference: the
      // payload must not add, remove or reorder a single element, in any
      // position, whether it was escaped or refused.
      const benign = parse(applyTemplate(template, { h: "SAFE" }).output);

      for (const payload of PAYLOADS) {
        const context = `${JSON.stringify(template)} + ${JSON.stringify(payload)}`;
        const attacked = parse(applyTemplate(template, { h: payload }).output);

        expect(attacked.shape, context).toBe(benign.shape);
        for (const name of attacked.attrs) {
          expect(name.startsWith("on"), `${context} -> ${name}`).toBe(false);
        }
        // A payload must never become executable text inside a raw-text
        // element, where no escape applies.
        expect(attacked.rawText, context).not.toContain("alert(1)");
      }
    }
  });

  it("substitutes rather than rejects wherever escaping is provably sufficient", () => {
    // The sweep above would also pass if every slot were refused, so pin down
    // that the safe positions really do substitute.
    const substituting = [
      "<h1>{{h}}</h1>",
      "<title>{{h}}</title>",
      "<textarea>{{h}}</textarea>",
      '<div data-x="{{h}}">y</div>',
      "<div data-x='{{h}}'>y</div>",
      "<!-- x {{h}} --><p>after</p>",
    ];
    for (const template of substituting) {
      const { output, warnings } = applyTemplate(template, { h: "PLAIN" });
      expect(warnings, template).toEqual([]);
      expect(output, template).toContain("PLAIN");
      expect(output, template).not.toContain("{{h}}");
    }
  });
});
