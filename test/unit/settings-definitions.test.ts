import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../src/ir/defaults.js";
import { SettingsSchema } from "../../src/ir/schema.js";
import { getSettingHelpDefinition, SETTING_HELP } from "../../src/ir/setting-help.js";
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

  it("keeps panel help copy in a sibling module, keyed by real settings", () => {
    expect(getSettingHelpDefinition("responsiveness")?.docsAnchor).toBe("responsiveness");
    expect(getSettingHelpDefinition("renderTextAs")?.summary).toContain("live HTML");
    expect(getSettingHelpDefinition("nonexistentSetting")).toBeUndefined();

    const known = new Set(SETTING_DEFINITIONS.map((definition) => definition.key as string));
    for (const key of Object.keys(SETTING_HELP)) {
      expect(known.has(key), `help copy for unknown setting "${key}"`).toBe(true);
      expect(getSettingDefinition(key)).toBeDefined();
    }
  });

  it("defaults Google Fonts off and validates supported modes", () => {
    expect(defaultSettings.googleFonts).toBe("none");
    expect(SettingsSchema.parse({ googleFonts: "none" }).googleFonts).toBe("none");
    expect(SettingsSchema.parse({ googleFonts: "import" }).googleFonts).toBe("import");
    expect(SettingsSchema.parse({ googleFonts: "link" }).googleFonts).toBe("link");
    expect(SettingsSchema.safeParse({ googleFonts: "auto" }).success).toBe(false);
  });
});
