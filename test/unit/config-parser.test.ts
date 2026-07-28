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

  // Moved from the deleted `parseEmitterConfig` wrapper: the validated emit
  // block and the path-qualified rejection are `parseConfigText` behavior.
  it("parses a validated emit block", () => {
    const config = parseConfigText(
      `{ "emit": { "html": { "positionMode": "percentage" } } }`,
      "emit.json",
    );
    expect(getEmitterConfig(config)).toEqual({ html: { positionMode: "percentage" } });
  });

  it("names the emit path when rejecting an invalid emitter value", () => {
    expect(() =>
      parseConfigText(`{ "emit": { "react": { "fitMode": "cover" } } }`, "emit.json"),
    ).toThrow(/emit.react/);
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

  it("accepts aifont and sourceFont together when they agree", () => {
    const config = parseConfigText(
      `{
        "fonts": [
          { "sourceFont": "ArialMT", "aifont": "ArialMT", "family": "Arial, sans-serif" }
        ]
      }`,
      "agreeing-fonts.json",
    );
    expect(config.fonts).toEqual([{ sourceFont: "ArialMT", family: "Arial, sans-serif" }]);
  });

  it("rejects a font entry whose aifont and sourceFont disagree", () => {
    // `sourceFont` used to silently win, hiding the conflict from the one
    // person who could resolve it.
    expect(() =>
      parseConfigText(
        `{
          "fonts": [
            { "sourceFont": "ArialMT", "aifont": "HelveticaNeue", "family": "Arial, sans-serif" }
          ]
        }`,
        "conflicting-fonts.json",
      ),
    ).toThrow(/aifont conflicts with sourceFont/);
  });

  it("rejects an unknown key inside a font entry", () => {
    // The top-level config was already strict; a typo inside a font entry was
    // silently stripped.
    expect(() =>
      parseConfigText(
        `{
          "fonts": [
            { "sourceFont": "ArialMT", "family": "Arial, sans-serif", "wieght": "700" }
          ]
        }`,
        "typo-fonts.json",
      ),
    ).toThrow(/wieght/);
  });
});
