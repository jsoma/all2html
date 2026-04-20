import { describe, expect, it } from "vitest";
import {
  createEmptySelectionSummary,
  exportBlockedMessage,
  exportWarningNoticeCopy,
  selectionModeLabel,
  selectionSummaryCopy,
  shouldShowReadyStatus,
} from "../../plugins/figma/src/ui.js";

describe("Figma selection UI behavior", () => {
  it("treats empty selection as guidance rather than an error state", () => {
    const empty = createEmptySelectionSummary();

    expect(selectionModeLabel(empty)).toBe("No eligible frames");
    expect(selectionSummaryCopy(empty)).toBe(
      "Select one or more top-level frames before exporting.",
    );
    expect(exportBlockedMessage(empty)).toBe(
      "Select one or more top-level frames before exporting.",
    );
    expect(shouldShowReadyStatus(empty, null)).toBe(false);
  });

  it("surfaces real selection errors instead of empty-selection guidance", () => {
    const invalid = {
      ...createEmptySelectionSummary(),
      totalSelected: 2,
      frameNames: ["story:640", "story:640"],
      error: 'Responsive group "story" has duplicate width 640px.',
    };

    expect(selectionModeLabel(invalid)).toBe("Selection issue");
    expect(selectionSummaryCopy(invalid)).toBe("Selection needs attention before exporting.");
    expect(exportBlockedMessage(invalid)).toBe(
      'Responsive group "story" has duplicate width 640px.',
    );
    expect(shouldShowReadyStatus(invalid, null)).toBe(false);
  });

  it("only shows ready status when selection and config are both exportable", () => {
    const ready = {
      totalSelected: 1,
      eligibleFrames: 1,
      frameNames: ["story"],
      groupNames: ["story"],
      groups: [
        {
          name: "story",
          frameCount: 1,
          frameNames: ["story"],
          widths: [640],
          mode: "single" as const,
        },
      ],
      exportKind: "single" as const,
    };

    expect(selectionSummaryCopy(ready)).toBe("1 frame selected. 1 single frame.");
    expect(shouldShowReadyStatus(ready, null)).toBe(true);
    expect(shouldShowReadyStatus(ready, "Invalid config")).toBe(false);
  });

  it("keeps mixed single and responsive summaries accurate", () => {
    const mixed = {
      totalSelected: 3,
      eligibleFrames: 3,
      frameNames: ["story:640", "story:960", "card"],
      groupNames: ["story", "card"],
      groups: [
        {
          name: "story",
          frameCount: 2,
          frameNames: ["story:640", "story:960"],
          widths: [640, 960],
          mode: "responsive" as const,
        },
        {
          name: "card",
          frameCount: 1,
          frameNames: ["card"],
          widths: [320],
          mode: "single" as const,
        },
      ],
      exportKind: "mixed" as const,
    };

    expect(selectionSummaryCopy(mixed)).toBe(
      "3 frames selected. 1 responsive group, 1 single frame.",
    );
  });

  it("builds a compact warning notice only when the last export had warnings", () => {
    expect(exportWarningNoticeCopy(0)).toBeNull();
    expect(exportWarningNoticeCopy(1)).toEqual({
      title: "Exported with 1 warning.",
      detail: "Review Last export below for details.",
    });
    expect(exportWarningNoticeCopy(3)).toEqual({
      title: "Exported with 3 warnings.",
      detail: "Review Last export below for details.",
    });
  });
});
