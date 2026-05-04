import { describe, expect, it } from "vitest";
import { createFontMap } from "../../src/core/font-map.js";

describe("createFontMap", () => {
  const lookup = createFontMap([]);

  it("finds built-in Arial", () => {
    const result = lookup("ArialMT");
    expect(result.matched).toBe(true);
    expect(result.info.family).toBe("arial,helvetica,sans-serif");
    expect(result.info.weight).toBe("");
  });

  it("finds built-in Arial Bold", () => {
    const result = lookup("Arial-BoldMT");
    expect(result.matched).toBe(true);
    expect(result.info.weight).toBe("700");
  });

  it("finds built-in Georgia Italic", () => {
    const result = lookup("Georgia-Italic");
    expect(result.matched).toBe(true);
    expect(result.info.style).toBe("italic");
  });

  it("finds built-in Inter SemiBold", () => {
    const result = lookup("Inter-SemiBold");
    expect(result.matched).toBe(true);
    expect(result.info.family).toBe("Inter,system-ui,sans-serif");
    expect(result.info.weight).toBe("600");
  });

  it("guesses weight for unknown bold font", () => {
    const result = lookup("Poppins-Bold");
    expect(result.matched).toBe(false);
    expect(result.info.weight).toBe("700");
  });

  it("guesses italic for unknown italic font", () => {
    const result = lookup("Poppins-Italic");
    expect(result.matched).toBe(false);
    expect(result.info.style).toBe("italic");
  });

  it("defaults to weight 500 for unknown regular font", () => {
    const result = lookup("Poppins-Regular");
    expect(result.matched).toBe(false);
    expect(result.info.weight).toBe("500");
  });

  it("custom fonts override builtins", () => {
    const custom = createFontMap([
      { sourceFont: "ArialMT", family: "'Custom Arial', sans-serif", weight: "400" },
    ]);
    const result = custom("ArialMT");
    expect(result.matched).toBe(true);
    expect(result.info.family).toBe("'Custom Arial', sans-serif");
  });
});
