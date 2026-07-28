import { describe, expect, it } from "vitest";
import {
  createWarning,
  formatGroupedWarnings,
  groupWarnings,
  pushUniqueStructuredWarning,
  type StructuredWarning,
  warningMessages,
} from "../../src/core/warnings.js";

describe("structured warnings", () => {
  it("carries a code, a category and the context the producer knew", () => {
    const warning = createWarning("font:unmapped", "font", "Missing a rule for converting font", {
      artboardId: "ab-1",
      layerId: "layer-1",
      elementId: "el-1",
    });

    expect(warning).toEqual({
      code: "font:unmapped",
      category: "font",
      message: "Missing a rule for converting font",
      artboardId: "ab-1",
      layerId: "layer-1",
      elementId: "el-1",
    });
  });

  it("omits absent context rather than writing undefined keys", () => {
    expect(Object.keys(createWarning("x:y", "other", "m"))).toEqual([
      "code",
      "category",
      "message",
    ]);
    expect(Object.keys(createWarning("x:y", "other", "m", {}))).toEqual([
      "code",
      "category",
      "message",
    ]);
  });

  it("projects to plain strings for consumers that expect them", () => {
    const warnings = [
      createWarning("a:b", "font", "first"),
      createWarning("c:d", "image", "second"),
    ];
    expect(warningMessages(warnings)).toEqual(["first", "second"]);
  });

  it("deduplicates on code plus message, not on identity", () => {
    const warnings: StructuredWarning[] = [];
    pushUniqueStructuredWarning(warnings, createWarning("a:b", "font", "same", { layerId: "l1" }));
    pushUniqueStructuredWarning(warnings, createWarning("a:b", "font", "same", { layerId: "l2" }));
    pushUniqueStructuredWarning(warnings, createWarning("a:c", "font", "same"));

    expect(warnings).toHaveLength(2);
    // First occurrence wins, so the recorded context is where it was first seen.
    expect(warnings[0].layerId).toBe("l1");
  });

  it("groups by the declared category, never by the prose", () => {
    // The message that motivated this change: the old substring classifier filed
    // "no fill color" under `other` because the word "font" was absent.
    const warnings = [
      createWarning("text:no-fill", "text", "Found a text element with no fill color"),
      createWarning("font:unmapped", "font", "Missing a rule for converting font: Foo"),
      createWarning("setting:unsupported", "setting", 'Setting "output" is not honored'),
    ];

    const groups = groupWarnings(warnings);
    expect(groups.map((group) => group.category)).toEqual(["setting", "font", "text"]);
    expect(groups[2].warnings[0].message).toContain("no fill color");
  });

  it("does not classify by substring: a settings warning mentioning a font stays a setting", () => {
    const warnings = [
      createWarning("setting:unsupported", "setting", 'Setting "googleFonts" mentions font'),
    ];
    expect(groupWarnings(warnings)).toEqual([{ category: "setting", warnings }]);
  });

  it("formats groups with their codes so a reader can act on them", () => {
    const text = formatGroupedWarnings(
      groupWarnings([createWarning("font:unmapped", "font", "Missing a rule")]),
    );
    expect(text).toBe("Fonts (1):\n  [font:unmapped] Missing a rule");
  });

  it("emits nothing for an empty warning list", () => {
    expect(groupWarnings([])).toEqual([]);
    expect(formatGroupedWarnings([])).toBe("");
  });
});
