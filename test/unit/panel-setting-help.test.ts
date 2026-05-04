import { describe, expect, it } from "vitest";

import {
  buildSettingHelpDocsUrl,
  getSettingHelp,
  resolveNextOpenHelpId,
  SETTING_HELP_DOCS_BASE_URL,
} from "../../plugins/illustrator/panel/src/js/setting-help.js";

describe("panel setting help metadata", () => {
  it("returns metadata for covered settings", () => {
    expect(getSettingHelp("responsiveness")).toMatchObject({
      docsAnchor: "responsiveness",
    });
    expect(getSettingHelp("imageFormat")?.optionNotes).toHaveProperty("Auto");
    expect(getSettingHelp("includeResizerCss")?.summary).toContain("responsive CSS");
  });

  it("returns undefined for settings that are not covered in v1", () => {
    expect(getSettingHelp("jpgQuality")).toBeUndefined();
    expect(getSettingHelp("pngTransparent")).toBeUndefined();
  });

  it("builds public docs urls from anchors", () => {
    expect(buildSettingHelpDocsUrl("inlineSvg")).toBe(
      `${SETTING_HELP_DOCS_BASE_URL}/reference/settings/#inlineSvg`,
    );
  });

  it("toggles the shared open help id", () => {
    expect(resolveNextOpenHelpId(null, "output")).toBe("output");
    expect(resolveNextOpenHelpId("output", "output")).toBeNull();
    expect(resolveNextOpenHelpId("output", "renderTextAs")).toBe("renderTextAs");
  });
});
