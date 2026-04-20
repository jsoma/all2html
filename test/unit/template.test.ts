import { describe, expect, it } from "vitest";
import { applyTemplate } from "../../src/core/template.js";

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
