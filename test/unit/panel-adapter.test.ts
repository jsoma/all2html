import { describe, expect, it } from "vitest";
import {
  exporterToPanelKey,
  exporterToPanelSettings,
  panelToExporterSettings,
} from "../../plugins/illustrator/panel/src/js/adapter.js";
import type { PanelSettings } from "../../plugins/illustrator/panel/src/shared/types.js";

describe("panelToExporterSettings", () => {
  it("converts camelCase panel keys to snake_case exporter keys", () => {
    const panel: PanelSettings = {
      imageFormat: "png",
      jpgQuality: 60,
      use2xImages: true,
      renderTextAs: "html",
      htmlOutputPath: "output/",
      googleFonts: "import",
      maxWidth: 600,
    };
    const result = panelToExporterSettings(panel);
    expect(result).toHaveProperty("image_format", "png");
    expect(result).toHaveProperty("jpg_quality", "60");
    expect(result).toHaveProperty("use_2x_images_if_possible", "true");
    expect(result).toHaveProperty("render_text_as", "html");
    expect(result).toHaveProperty("html_output_path", "output/");
    expect(result).toHaveProperty("google_fonts", "import");
    expect(result).toHaveProperty("max_width", "600");
    // No camelCase keys should remain
    expect(result).not.toHaveProperty("imageFormat");
    expect(result).not.toHaveProperty("jpgQuality");
  });

  it("converts all values to strings", () => {
    const panel: PanelSettings = {
      jpgQuality: 80,
      pngNumberOfColors: 256,
      use2xImages: false,
      testingMode: true,
      centerHtmlOutput: false,
      namespace: "g-",
    };
    const result = panelToExporterSettings(panel);
    for (const value of Object.values(result)) {
      expect(typeof value).toBe("string");
    }
    expect(result.jpg_quality).toBe("80");
    expect(result.png_number_of_colors).toBe("256");
    expect(result.use_2x_images_if_possible).toBe("false");
    expect(result.testing_mode).toBe("true");
    expect(result.center_html_output).toBe("false");
    expect(result.namespace).toBe("g-");
  });

  it("excludes undefined and null values", () => {
    const panel: PanelSettings = {
      imageFormat: "jpg",
      maxWidth: null,
      // jpgQuality is not set (undefined)
    };
    const result = panelToExporterSettings(panel);
    expect(result).toHaveProperty("image_format", "jpg");
    expect(result).not.toHaveProperty("max_width");
    expect(result).not.toHaveProperty("jpg_quality");
  });

  it("returns empty object for empty input", () => {
    const result = panelToExporterSettings({});
    expect(result).toEqual({});
  });

  it("maps the output key unchanged", () => {
    const panel: PanelSettings = { output: "one-file" };
    const result = panelToExporterSettings(panel);
    expect(result).toHaveProperty("output", "one-file");
  });

  it("maps responsiveness key unchanged", () => {
    const panel: PanelSettings = { responsiveness: "dynamic" };
    const result = panelToExporterSettings(panel);
    expect(result).toHaveProperty("responsiveness", "dynamic");
  });
});

describe("exporterToPanelSettings", () => {
  it("maps exporter keys back to panel keys", () => {
    expect(exporterToPanelKey("image_format")).toBe("imageFormat");
    expect(exporterToPanelKey("render_text_as")).toBe("renderTextAs");
    expect(exporterToPanelKey("not_a_real_key")).toBeUndefined();
  });

  it("converts snake_case exporter keys to camelCase panel keys", () => {
    const exporter: Record<string, string> = {
      image_format: "png",
      jpg_quality: "60",
      use_2x_images_if_possible: "true",
      render_text_as: "html",
      html_output_path: "output/",
      google_fonts: "link",
      max_width: "600",
    };
    const result = exporterToPanelSettings(exporter);
    expect(result.imageFormat).toBe("png");
    expect(result.jpgQuality).toBe(60);
    expect(result.use2xImages).toBe(true);
    expect(result.renderTextAs).toBe("html");
    expect(result.htmlOutputPath).toBe("output/");
    expect(result.googleFonts).toBe("link");
    expect(result.maxWidth).toBe(600);
  });

  it("accepts canonical camelCase settings when reading config", () => {
    const result = exporterToPanelSettings({
      googleFonts: "link",
      renderTextAs: "image",
      htmlOutputPath: "dist/",
    });

    expect(result.googleFonts).toBe("link");
    expect(result.renderTextAs).toBe("image");
    expect(result.htmlOutputPath).toBe("dist/");
  });

  it("converts string 'true'/'false' to booleans", () => {
    const exporter: Record<string, string> = {
      use_2x_images_if_possible: "true",
      testing_mode: "false",
      center_html_output: "true",
      png_transparent: "false",
    };
    const result = exporterToPanelSettings(exporter);
    expect(result.use2xImages).toBe(true);
    expect(result.testingMode).toBe(false);
    expect(result.centerHtmlOutput).toBe(true);
    expect(result.pngTransparent).toBe(false);
  });

  it("converts numeric strings to numbers", () => {
    const exporter: Record<string, string> = {
      jpg_quality: "80",
      png_number_of_colors: "256",
      max_width: "1200",
    };
    const result = exporterToPanelSettings(exporter);
    expect(result.jpgQuality).toBe(80);
    expect(result.pngNumberOfColors).toBe(256);
    expect(result.maxWidth).toBe(1200);
  });

  it("passes through non-numeric, non-boolean strings as-is", () => {
    const exporter: Record<string, string> = {
      image_format: "svg",
      responsiveness: "dynamic",
      namespace: "custom-",
      html_output_path: "build/output/",
    };
    const result = exporterToPanelSettings(exporter);
    expect(result.imageFormat).toBe("svg");
    expect(result.responsiveness).toBe("dynamic");
    expect(result.namespace).toBe("custom-");
    expect(result.htmlOutputPath).toBe("build/output/");
  });

  it("ignores unknown exporter keys not in the reverse map", () => {
    const exporter: Record<string, string> = {
      image_format: "png",
      some_unknown_key: "hello",
      another_random_key: "world",
    };
    const result = exporterToPanelSettings(exporter);
    expect(result.imageFormat).toBe("png");
    expect(result).not.toHaveProperty("some_unknown_key");
    expect(result).not.toHaveProperty("someUnknownKey");
    expect(result).not.toHaveProperty("another_random_key");
    expect(result).not.toHaveProperty("anotherRandomKey");
  });

  it("returns empty object for empty input", () => {
    const result = exporterToPanelSettings({});
    expect(result).toEqual({});
  });

  it("passes through already-typed values when not strings", () => {
    // exporterToPanelSettings accepts Record<string, unknown>, so non-string values
    // should be passed through without conversion
    const exporter: Record<string, unknown> = {
      jpg_quality: 80,
      use_2x_images_if_possible: true,
      testing_mode: false,
    };
    const result = exporterToPanelSettings(exporter);
    expect(result.jpgQuality).toBe(80);
    expect(result.use2xImages).toBe(true);
    expect(result.testingMode).toBe(false);
  });
});

describe("round-trip: panel → exporter → panel", () => {
  it("preserves values through a full round-trip with expected coercion", () => {
    const original: PanelSettings = {
      output: "one-file",
      imageFormat: "jpg",
      jpgQuality: 80,
      pngNumberOfColors: 256,
      use2xImages: true,
      responsiveness: "dynamic",
      renderTextAs: "html",
      htmlOutputPath: "output/",
      googleFonts: "link",
      namespace: "g-",
      maxWidth: 600,
      testingMode: false,
      centerHtmlOutput: true,
    };

    const exporter = panelToExporterSettings(original);
    const roundTripped = exporterToPanelSettings(exporter);

    expect(roundTripped.output).toBe(original.output);
    expect(roundTripped.imageFormat).toBe(original.imageFormat);
    expect(roundTripped.jpgQuality).toBe(original.jpgQuality);
    expect(roundTripped.pngNumberOfColors).toBe(original.pngNumberOfColors);
    expect(roundTripped.use2xImages).toBe(original.use2xImages);
    expect(roundTripped.responsiveness).toBe(original.responsiveness);
    expect(roundTripped.renderTextAs).toBe(original.renderTextAs);
    expect(roundTripped.htmlOutputPath).toBe(original.htmlOutputPath);
    expect(roundTripped.googleFonts).toBe(original.googleFonts);
    expect(roundTripped.namespace).toBe(original.namespace);
    expect(roundTripped.maxWidth).toBe(original.maxWidth);
    expect(roundTripped.testingMode).toBe(original.testingMode);
    expect(roundTripped.centerHtmlOutput).toBe(original.centerHtmlOutput);
  });

  it("round-trips an empty settings object", () => {
    const original: PanelSettings = {};
    const exporter = panelToExporterSettings(original);
    const roundTripped = exporterToPanelSettings(exporter);
    expect(roundTripped).toEqual({});
  });

  it("round-trips string-valued settings unchanged", () => {
    const original: PanelSettings = {
      namespace: "my-prefix-",
      htmlOutputPath: "/some/deep/path/",
      svgIdPrefix: "svg-prefix-",
      altText: "A chart showing data",
      clickableLink: "https://example.com",
      ariaRole: "img",
    };
    const exporter = panelToExporterSettings(original);
    const roundTripped = exporterToPanelSettings(exporter);
    expect(roundTripped).toEqual(original);
  });
});
