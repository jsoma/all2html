import { describe, expect, it } from "vitest";
import {
  buildGoogleFontsUrl,
  getPrimaryCssFamily,
  renderGoogleFontsImport,
  renderGoogleFontsLinkTags,
} from "../../src/emitters/shared/google-fonts.js";
import type { FontMapping } from "../../src/ir/types.js";

describe("google fonts helper", () => {
  it("uses the first concrete CSS family from a family list", () => {
    expect(getPrimaryCssFamily("'IBM Plex Sans', system-ui, sans-serif")).toBe("IBM Plex Sans");
    expect(getPrimaryCssFamily('"Newsreader", Georgia, serif')).toBe("Newsreader");
    expect(getPrimaryCssFamily("Inter, system-ui, sans-serif")).toBe("Inter");
    expect(getPrimaryCssFamily("system-ui, 'IBM Plex Sans', sans-serif")).toBe("IBM Plex Sans");
    expect(getPrimaryCssFamily("Arial, 'Roboto Slab', serif")).toBe("Roboto Slab");
    expect(getPrimaryCssFamily("system-ui, sans-serif")).toBeNull();
  });

  it("builds CSS2 URLs for multi-family, multi-weight, and italic requests", () => {
    const fonts: FontMapping[] = [
      { sourceFont: "Inter-Regular", family: "Inter,system-ui,sans-serif", weight: "normal" },
      {
        sourceFont: "Inter-BoldItalic",
        family: "Inter,system-ui,sans-serif",
        weight: "bold",
        style: "italic",
      },
      {
        sourceFont: "IBM Plex Sans-SemiBold",
        family: "'IBM Plex Sans',system-ui,sans-serif",
        weight: "600",
      },
      { sourceFont: "ArialMT", family: "Arial, sans-serif", weight: "400" },
    ];

    expect(buildGoogleFontsUrl(fonts)).toBe(
      "https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;1,700&family=IBM+Plex+Sans:wght@600&display=swap",
    );
  });

  it("normalizes numeric weights and preserves italic-only families", () => {
    expect(
      buildGoogleFontsUrl([
        {
          sourceFont: "Lora-Italic",
          family: "Lora,serif",
          weight: "regular",
          style: "italic",
        },
        {
          sourceFont: "Newsreader-Oblique",
          family: "Newsreader,serif",
          weight: "650",
          style: "oblique",
        },
        {
          sourceFont: "Newsreader-Heavy",
          family: "Newsreader,serif",
          weight: "975",
        },
        {
          sourceFont: "Poppins-Thin",
          family: "Poppins,sans-serif",
          weight: "50",
        },
      ]),
    ).toBe(
      "https://fonts.googleapis.com/css2?family=Lora:ital,wght@1,400&family=Newsreader:ital,wght@0,900;1,700&family=Poppins:wght@100&display=swap",
    );
  });

  it("renders import and escaped link markup", () => {
    const fonts: FontMapping[] = [
      { sourceFont: "Source Serif", family: "'Source Serif 4', Georgia, serif", weight: "400" },
    ];

    expect(renderGoogleFontsImport(fonts)).toBe(
      '@import url("https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400&display=swap");',
    );
    expect(renderGoogleFontsLinkTags(fonts)).toContain(
      'href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400&amp;display=swap"',
    );
  });
});

/**
 * The Zod-free call path.
 *
 * `FontMapping` is a compile-time claim, and two surfaces reach these helpers
 * with nothing enforcing it at runtime: Illustrator and After Effects both read
 * font mappings out of an unvalidated `all2html.config.json`. `compute-styles.ts`
 * already checked a non-string family and fell back with a warning; this module
 * did not, so the same malformed mapping that merely warned in the CSS path
 * threw `cssFamily.charAt is not a function` and failed the entire export.
 *
 * These cast deliberately — the point is what happens when the type is wrong.
 */
describe("malformed font mappings from a surface with no schema", () => {
  const malformed = [
    { label: "a numeric family", font: { sourceFont: "ArialMT", family: 700 } },
    { label: "an array family", font: { sourceFont: "ArialMT", family: [] } },
    { label: "an object family", font: { sourceFont: "ArialMT", family: { a: 1 } } },
    { label: "a missing family", font: { sourceFont: "ArialMT" } },
    { label: "a null entry", font: null },
  ];

  for (const { label, font } of malformed) {
    it(`skips ${label} instead of throwing`, () => {
      const fonts = [font, { sourceFont: "Inter-Bold", family: "Inter", weight: "700" }];
      const list = fonts as unknown as FontMapping[];

      expect(() => buildGoogleFontsUrl(list)).not.toThrow();
      // The well-formed sibling is still requested.
      expect(buildGoogleFontsUrl(list)).toContain("Inter");
      expect(renderGoogleFontsLinkTags(list)).toContain("Inter");
      expect(renderGoogleFontsImport(list)).toContain("Inter");
    });
  }

  it("returns no URL when every mapping is malformed", () => {
    const list = [{ sourceFont: "ArialMT", family: 700 }] as unknown as FontMapping[];
    expect(buildGoogleFontsUrl(list)).toBeNull();
  });
});
