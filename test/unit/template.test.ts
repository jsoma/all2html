import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { applyTemplate, rawTemplateValue } from "../../src/core/template.js";

describe("applyTemplate", () => {
  const vars = {
    headline: "Breaking News",
    credit: "By Staff",
    projectName: "test-project",
  };

  // Substituted values are escaped for *every* position a slot can occupy, which
  // includes an unquoted attribute value — so an inner space becomes `&#32;`.
  // The reference decodes back to a space in both text and attribute contexts, so
  // the rendered page is unchanged; see the escaping suite below.
  const NEWS = "Breaking&#32;News";
  const STAFF = "By&#32;Staff";

  it("replaces Mustache variables", () => {
    expect(applyTemplate("{{headline}}", vars)).toBe(NEWS);
    expect(applyTemplate("{{{headline}}}", vars)).toBe(NEWS);
  });

  it("replaces EJS variables", () => {
    expect(applyTemplate("<%= headline %>", vars)).toBe(NEWS);
    expect(applyTemplate("<%- headline %>", vars)).toBe(NEWS);
  });

  it("is case-insensitive", () => {
    expect(applyTemplate("{{Headline}}", vars)).toBe(NEWS);
    expect(applyTemplate("{{HEADLINE}}", vars)).toBe(NEWS);
  });

  it("leaves unmatched variables as-is", () => {
    expect(applyTemplate("{{unknown}}", vars)).toBe("{{unknown}}");
  });

  it("handles multiple variables in one string", () => {
    const result = applyTemplate("{{headline}} - {{credit}}", vars);
    expect(result).toBe(`${NEWS} - ${STAFF}`);
  });

  it("handles mixed Mustache and EJS", () => {
    const result = applyTemplate("{{headline}} / <%= credit %>", vars);
    expect(result).toBe(`${NEWS} / ${STAFF}`);
  });

  it("leaves a value with nothing to escape byte-identical", () => {
    expect(applyTemplate("{{projectName}}", vars)).toBe("test-project");
  });
});

/**
 * Substituted values used to be spliced in verbatim, so a `headline` carrying
 * markup became live markup in a `localPreviewTemplate` render. Every other
 * metadata path in the product escapes; this one did not.
 */
describe("applyTemplate escaping", () => {
  const payload = `<img src=x onerror=alert(1)>`;

  const escapedPayload = "&lt;img&#32;src&#61;x&#32;onerror&#61;alert(1)&gt;";

  it("escapes markup in a substituted value", () => {
    expect(applyTemplate("<h1>{{headline}}</h1>", { headline: payload })).toBe(
      `<h1>${escapedPayload}</h1>`,
    );
  });

  it("escapes both quote characters, because a slot can sit in an attribute", () => {
    // A narrowed text-context escape would leave `"` alone and the payload
    // would close the attribute and add its own.
    const result = applyTemplate('<meta content="{{headline}}">', {
      headline: `" onload="alert(1)`,
    });
    expect(result).toBe('<meta content="&quot;&#32;onload&#61;&quot;alert(1)">');
    expect(applyTemplate("<p title='{{headline}}'>", { headline: "it's" })).toBe(
      "<p title='it&#39;s'>",
    );
  });

  /**
   * The escape set used to be `& < > " '`, which is sufficient for text and for a
   * *quoted* attribute and for nothing else. HTML's unquoted-attribute-value state
   * ends at whitespace, so `<div data-t={{h}}>` with a value carrying a space
   * emitted a second, live attribute — a working event handler, verified.
   */
  it("cannot split an unquoted attribute value into a second attribute", () => {
    const result = applyTemplate("<div data-t={{h}}>", { h: "x onmouseover=alert(1)" });
    expect(result).toBe("<div data-t=x&#32;onmouseover&#61;alert(1)>");

    const div = new JSDOM(result).window.document.querySelector("div");
    expect(div?.getAttribute("data-t")).toBe("x onmouseover=alert(1)");
    expect(div?.hasAttribute("onmouseover")).toBe(false);
    expect(div?.attributes).toHaveLength(1);
  });

  it("cannot inject an attribute from attribute-name or tag-name position", () => {
    const named = applyTemplate("<div {{h}}>", { h: "id=x onclick=alert(1)" });
    const namedDiv = new JSDOM(named).window.document.querySelector("div");
    expect(namedDiv?.attributes).toHaveLength(1);
    expect(namedDiv?.hasAttribute("onclick")).toBe(false);

    // Whitespace is also what separates a tag name from its attribute list.
    const tag = applyTemplate("<{{h}}>x</div>", { h: "div onload=alert(1)" });
    expect(tag).not.toContain(" onload");
  });

  it("escapes every character the unquoted-attribute grammar reacts to", () => {
    expect(applyTemplate("{{h}}", { h: "a\tb\nc\fd e=f`g" })).toBe(
      "a&#9;b&#10;c&#12;d&#32;e&#61;f&#96;g",
    );
  });

  it("renders an ampersand as a single entity, not a double-escaped one", () => {
    expect(applyTemplate("{{credit}}", { credit: "Smith & Sons" })).toBe(
      "Smith&#32;&amp;&#32;Sons",
    );
    // The reference decodes back to the original text; only the bytes are noisier.
    const p = applyTemplate("<p>{{credit}}</p>", { credit: "Smith & Sons" });
    expect(new JSDOM(p).window.document.querySelector("p")?.textContent).toBe("Smith & Sons");
  });

  it("substitutes a rawTemplateValue verbatim, which is the markup escape hatch", () => {
    const fragment = '<div id="g-chart">&amp; on we go</div>';
    expect(applyTemplate("{{partial}}", { partial: rawTemplateValue(fragment) })).toBe(fragment);
  });

  it("never rescans substituted content, so a value cannot smuggle in a second slot", () => {
    const result = applyTemplate("{{partial}}", {
      partial: rawTemplateValue("<%= secret %>"),
      secret: "leaked",
    });
    expect(result).toBe("<%= secret %>");
  });
});
