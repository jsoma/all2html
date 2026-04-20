import { describe, expect, it } from "vitest";
import {
  resolveSettingsLayers,
  summarizeSettingSources,
} from "../../plugins/illustrator/panel/src/js/persistence.js";
import {
  getEditedKeys,
  getFieldBadge,
  getFieldBadgeTitle,
} from "../../plugins/illustrator/panel/src/js/provenance.js";
import {
  createFontEntry,
  getFontSourceName,
} from "../../plugins/illustrator/panel/src/shared/types.js";

describe("panel settings provenance", () => {
  it("tracks per-field source priority as text block > XMP > config > app defaults", () => {
    const resolved = resolveSettingsLayers({
      appDefaults: {
        version: "1.0.0",
        settings: {
          output: "multiple-files",
          imageFormat: "jpg",
          htmlOutputPath: "defaults-output/",
        },
        fonts: [{ aifont: "ArialMT", family: "Arial" }],
      },
      configSettings: {
        imageFormat: "png",
        htmlOutputPath: "config-output/",
        jpgQuality: 72,
      },
      configFonts: [{ sourceFont: "ArialMT", family: "Helvetica Neue" }],
      xmpData: {
        version: "1.0.0",
        settings: {
          imageFormat: "svg",
          pngNumberOfColors: 32,
        },
        fonts: [{ aifont: "ArialMT", family: "Inter" }],
      },
      textBlockRaw: {
        image_format: "png24",
        html_output_path: "doc-output/",
      },
    });

    expect(resolved.settings.output).toBe("multiple-files");
    expect(resolved.settings.imageFormat).toBe("png24");
    expect(resolved.settings.htmlOutputPath).toBe("doc-output/");
    expect(resolved.settings.jpgQuality).toBe(72);
    expect(resolved.settings.pngNumberOfColors).toBe(32);
    expect(resolved.fonts).toEqual([
      {
        sourceFont: "ArialMT",
        aifont: "ArialMT",
        family: "Inter",
      },
    ]);

    expect(resolved.fieldSources.output).toBe("app-defaults");
    expect(resolved.fieldSources.jpgQuality).toBe("config-file");
    expect(resolved.fieldSources.pngNumberOfColors).toBe("document-xmp");
    expect(resolved.fieldSources.imageFormat).toBe("text-block");
    expect(resolved.fieldSources.htmlOutputPath).toBe("text-block");
    expect(resolved.documentControlledKeys).toEqual(["imageFormat", "htmlOutputPath"]);
  });

  it("summarizes mixed field sources without counting text-block locks as the overall source", () => {
    expect(
      summarizeSettingSources({
        imageFormat: "config-file",
        output: "document-xmp",
        htmlOutputPath: "text-block",
      }),
    ).toBe("mixed");

    expect(
      summarizeSettingSources({
        output: "text-block",
        imageFormat: "text-block",
      }),
    ).toBe("core-defaults");
  });

  it("computes edited keys against inherited resolved values", () => {
    const editedKeys = getEditedKeys(
      {
        imageFormat: "png",
        clickableLink: "https://example.com",
      },
      {
        imageFormat: "jpg",
        clickableLink: "",
      },
      ["output"],
    );

    expect(editedKeys).toEqual(["imageFormat", "clickableLink"]);
  });

  it("prefers doc badge, then edit badge, then inherited source badge", () => {
    const fieldSources = {
      imageFormat: "config-file",
      clickableLink: "document-xmp",
    } as const;

    expect(getFieldBadge(fieldSources, "imageFormat", true, true)).toBe("doc");
    expect(getFieldBadge(fieldSources, "imageFormat", false, true)).toBe("edit");
    expect(getFieldBadge(fieldSources, "imageFormat", false, false)).toBe("cfg");
    expect(getFieldBadge(fieldSources, "clickableLink", false, false)).toBe("xmp");
    expect(getFieldBadgeTitle(fieldSources, "imageFormat", false, true)).toBe(
      "Edited in the panel for this document",
    );
  });

  it("normalizes panel font entries to a shared sourceFont key", () => {
    const resolved = resolveSettingsLayers({
      appDefaults: {
        version: "1.0.0",
        settings: {},
        fonts: [createFontEntry("ArialMT", { family: "Arial" })],
      },
    });

    expect(getFontSourceName(resolved.fonts[0])).toBe("ArialMT");
    expect(resolved.fonts[0].aifont).toBe("ArialMT");
    expect(resolved.fonts[0].sourceFont).toBe("ArialMT");
  });
});
