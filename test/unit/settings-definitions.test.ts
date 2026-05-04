import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../src/ir/defaults.js";
import { SettingsSchema } from "../../src/ir/schema.js";
import {
  createDefaultSettings,
  getSettingDefault,
  getSettingDefinition,
  SETTING_DEFINITIONS,
} from "../../src/ir/settings-definitions.js";

describe("settings definitions", () => {
  it("is the source for default settings and schema validation", () => {
    const defaults = createDefaultSettings();

    expect(defaultSettings).toEqual(defaults);
    expect(SettingsSchema.parse(defaults)).toEqual(defaults);
    expect(Object.keys(defaults).sort()).toEqual(
      SETTING_DEFINITIONS.map((definition) => definition.key).sort(),
    );
  });

  it("returns cloned defaults for mutable values", () => {
    const first = getSettingDefault("imageFormat");
    const second = getSettingDefault("imageFormat");

    expect(first).toEqual(["auto"]);
    expect(first).not.toBe(second);
  });

  it("carries panel help metadata for documented settings", () => {
    expect(getSettingDefinition("responsiveness")?.help?.docsAnchor).toBe("responsiveness");
    expect(getSettingDefinition("renderTextAs")?.help?.summary).toContain("live HTML");
  });

  it("defaults Google Fonts off and validates supported modes", () => {
    expect(defaultSettings.googleFonts).toBe("none");
    expect(SettingsSchema.parse({ googleFonts: "none" }).googleFonts).toBe("none");
    expect(SettingsSchema.parse({ googleFonts: "import" }).googleFonts).toBe("import");
    expect(SettingsSchema.parse({ googleFonts: "link" }).googleFonts).toBe("link");
    expect(SettingsSchema.safeParse({ googleFonts: "auto" }).success).toBe(false);
  });
});
