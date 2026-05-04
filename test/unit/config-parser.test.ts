import { describe, expect, it } from "vitest";
import { getConfigSettings, getEmitterConfig, parseConfigText } from "../../src/core/config.js";

describe("config parser", () => {
  it("parses jsonc config for shared browser and CLI use", () => {
    const config = parseConfigText(
      `{
        // comment
        "settings": {
          "imageFormat": ["jpg"],
          "pngTransparent": false,
          "googleFonts": "import"
        },
        "fonts": [
          { "sourceFont": "ArialMT", "family": "Arial, sans-serif", "weight": "400" }
        ],
        "emit": {
          "react": { "typescript": true }
        }
      }`,
      "browser-config.jsonc",
    );

    expect(getConfigSettings(config)?.imageFormat).toEqual(["jpg"]);
    expect(getConfigSettings(config)?.googleFonts).toBe("import");
    expect(config.fonts?.[0].sourceFont).toBe("ArialMT");
    expect(getEmitterConfig(config)?.react?.typescript).toBe(true);
  });

  it("throws a helpful error for invalid config content", () => {
    expect(() =>
      parseConfigText(`{ "emit": { "react": { "typescript": "nope" } } }`, "bad.json"),
    ).toThrow(/Invalid config file "bad\.json"/);
  });

  it("allows settings-only config files", () => {
    const config = parseConfigText(
      `{
        "settings": { "googleFonts": "link" }
      }`,
      "settings-only.json",
    );

    expect(config.emit).toEqual({});
    expect(config.settings?.googleFonts).toBe("link");
  });

  it("normalizes legacy aifont config entries to sourceFont", () => {
    const config = parseConfigText(
      `{
        "fonts": [
          { "aifont": "HelveticaNeue-Bold", "family": "'Helvetica Neue', sans-serif" }
        ],
        "emit": {}
      }`,
      "legacy-fonts.json",
    );

    expect(config.fonts).toEqual([
      { sourceFont: "HelveticaNeue-Bold", family: "'Helvetica Neue', sans-serif" },
    ]);
  });
});
