import { describe, expect, it } from "vitest";
import { applyTemplate, rawTemplateValue } from "../../src/core/template.js";

describe("applyTemplate", () => {
  const vars = {
    headline: "Breaking News",
    credit: "By Staff",
    projectName: "test-project",
  };

  it("replaces Mustache variables", () => {
    expect(applyTemplate("{{headline}}", vars)).toBe("Breaking News");
    expect(applyTemplate("{{{headline}}}", vars)).toBe("Breaking News");
  });

  it("replaces EJS variables", () => {
    expect(applyTemplate("<%= headline %>", vars)).toBe("Breaking News");
    expect(applyTemplate("<%- headline %>", vars)).toBe("Breaking News");
  });

  it("is case-insensitive", () => {
    expect(applyTemplate("{{Headline}}", vars)).toBe("Breaking News");
    expect(applyTemplate("{{HEADLINE}}", vars)).toBe("Breaking News");
  });

  it("leaves unmatched variables as-is", () => {
    expect(applyTemplate("{{unknown}}", vars)).toBe("{{unknown}}");
  });

  it("handles multiple variables in one string", () => {
    const result = applyTemplate("{{headline}} - {{credit}}", vars);
    expect(result).toBe("Breaking News - By Staff");
  });

  it("handles mixed Mustache and EJS", () => {
    const result = applyTemplate("{{headline}} / <%= credit %>", vars);
    expect(result).toBe("Breaking News / By Staff");
  });
});

/**
 * Substituted values used to be spliced in verbatim, so a `headline` carrying
 * markup became live markup in a `localPreviewTemplate` render. Every other
 * metadata path in the product escapes; this one did not.
 */
describe("applyTemplate escaping", () => {
  const payload = `<img src=x onerror=alert(1)>`;

  it("escapes markup in a substituted value", () => {
    expect(applyTemplate("<h1>{{headline}}</h1>", { headline: payload })).toBe(
      "<h1>&lt;img src=x onerror=alert(1)&gt;</h1>",
    );
  });

  it("escapes both quote characters, because a slot can sit in an attribute", () => {
    // A narrowed text-context escape would leave `"` alone and the payload
    // would close the attribute and add its own.
    const result = applyTemplate('<meta content="{{headline}}">', {
      headline: `" onload="alert(1)`,
    });
    expect(result).toBe('<meta content="&quot; onload=&quot;alert(1)">');
    expect(applyTemplate("<p title='{{headline}}'>", { headline: "it's" })).toBe(
      "<p title='it&#39;s'>",
    );
  });

  it("escapes the same way through every syntax, including triple mustache", () => {
    for (const slot of ["{{headline}}", "{{{headline}}}", "<%= headline %>", "<%- headline %>"]) {
      expect(applyTemplate(slot, { headline: payload })).toBe("&lt;img src=x onerror=alert(1)&gt;");
    }
  });

  it("renders an ampersand as a single entity, not a double-escaped one", () => {
    expect(applyTemplate("{{credit}}", { credit: "Smith & Sons" })).toBe("Smith &amp; Sons");
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
