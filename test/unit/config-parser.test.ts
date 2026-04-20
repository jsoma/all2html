import { describe, expect, it } from "vitest";
import { getConfigSettings, getEmitterConfig, parseConfigText } from "../../src/core/config.js";

describe("config parser", () => {
  it("parses jsonc config for shared browser and CLI use", () => {
    const config = parseConfigText(
      `{
        // comment
        "settings": {
          "imageFormat": ["jpg"],
          "pngTransparent": false
        },
        "fonts": [
          { "aifont": "ArialMT", "family": "Arial, sans-serif", "weight": "400" }
        ],
        "emit": {
          "react": { "typescript": true }
        }
      }`,
      "browser-config.jsonc",
    );

    expect(getConfigSettings(config)?.imageFormat).toEqual(["jpg"]);
    expect(config.fonts?.[0].aifont).toBe("ArialMT");
    expect(getEmitterConfig(config)?.react?.typescript).toBe(true);
  });

  it("throws a helpful error for invalid config content", () => {
    expect(() =>
      parseConfigText(`{ "emit": { "react": { "typescript": "nope" } } }`, "bad.json"),
    ).toThrow(/Invalid config file "bad\.json"/);
  });
});
