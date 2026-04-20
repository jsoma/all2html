import { describe, expect, it } from "vitest";
import {
  applyDirectControlsToConfig,
  buildLocalUiState,
  createEmptySelectionSummary,
  createInitialDirectControls,
  createInitialUiState,
  detectPresetFromControls,
  directControlsFromConfig,
  exportBlockedMessage,
  getPresetControls,
  getValidationMessages,
  hydrateUiStateFromLocalState,
  isExportBlocked,
  parseConfigEditorText,
  selectionModeLabel,
  selectionSummaryCopy,
  serializePluginConfig,
  shouldShowReadyStatus,
} from "../../plugins/figma/src/ui.js";

describe("Figma UI model", () => {
  it("keeps direct controls and canonical config in sync", () => {
    const controls = directControlsFromConfig({
      settings: {
        projectName: "primary-story",
        output: "multiple-files",
        responsiveness: "dynamic",
        imageFormat: ["jpg"],
        renderTextAs: "image",
        renderRotatedSkewedTextAs: "image",
        centerHtmlOutput: false,
        responsiveImageMode: "css-var",
      },
      metadata: {
        headline: "Topline",
        altText: "Overall alt text",
      },
    });

    const config = applyDirectControlsToConfig({}, controls);
    expect(config.settings?.projectName).toBe("primary-story");
    expect(config.settings?.output).toBe("multiple-files");
    expect(config.settings?.imageFormat).toEqual(["jpg"]);
    expect(config.metadata?.headline).toBe("Topline");
    expect(serializePluginConfig(config)).toContain('"projectName": "primary-story"');
  });

  it("defines the expected preset defaults", () => {
    expect(getPresetControls("standard-story")).toMatchObject({
      responsiveness: "fixed",
      output: "one-file",
      renderTextAs: "html",
      renderRotatedSkewedTextAs: "html",
      imageFormat: "auto",
      responsiveImageMode: "img-src",
    });
    expect(getPresetControls("responsive-story")).toMatchObject({
      responsiveness: "dynamic",
      output: "one-file",
      renderTextAs: "html",
      renderRotatedSkewedTextAs: "html",
      imageFormat: "auto",
      responsiveImageMode: "img-src",
    });
    expect(getPresetControls("image-only-graphic")).toMatchObject({
      responsiveness: "fixed",
      output: "one-file",
      renderTextAs: "image",
      renderRotatedSkewedTextAs: "image",
      imageFormat: "png",
    });
  });

  it("keeps presets stable across content edits but drifts on workflow changes", () => {
    expect(detectPresetFromControls(createInitialDirectControls())).toBe("standard-story");
    expect(detectPresetFromControls(getPresetControls("responsive-story"))).toBe(
      "responsive-story",
    );
    expect(detectPresetFromControls(getPresetControls("image-only-graphic"))).toBe(
      "image-only-graphic",
    );
    expect(
      detectPresetFromControls({
        ...getPresetControls("standard-story"),
        headline: "Local headline override",
        projectName: "story-slug",
        altText: "Overall alt text",
      }),
    ).toBe("standard-story");
    expect(
      detectPresetFromControls({
        ...getPresetControls("standard-story"),
        renderTextAs: "image",
      }),
    ).toBe("custom");
  });

  it("reports invalid JSONC without clobbering the last good config", () => {
    const parsed = parseConfigEditorText('{ "settings": { "output": "multiple-files" } }');
    expect(parsed.configError).toBeNull();
    expect(parsed.parsedConfig.settings?.output).toBe("multiple-files");

    const invalid = parseConfigEditorText('{ "settings": { ');
    expect(invalid.configError).toMatch(/Invalid Figma config JSONC/i);
    expect(invalid.parsedConfig).toEqual({});
  });

  it("hydrates and serializes local ui state with presets and disclosures", () => {
    const state = createInitialUiState(createEmptySelectionSummary());
    hydrateUiStateFromLocalState(state, {
      format: "standalone",
      advancedOpen: true,
      moreSettingsOpen: true,
      preset: "responsive-story",
    });

    expect(state.format).toBe("standalone");
    expect(state.advancedOpen).toBe(true);
    expect(state.moreSettingsOpen).toBe(true);
    expect(state.preset).toBe("responsive-story");
    expect(buildLocalUiState(state)).toEqual({
      format: "standalone",
      advancedOpen: true,
      moreSettingsOpen: true,
      preset: "responsive-story",
    });
  });

  it("keeps non-default presets represented in canonical config", () => {
    const responsiveConfig = applyDirectControlsToConfig({}, getPresetControls("responsive-story"));
    expect(responsiveConfig.settings?.responsiveness).toBe("dynamic");

    const imageOnlyConfig = applyDirectControlsToConfig(
      {},
      getPresetControls("image-only-graphic"),
    );
    expect(imageOnlyConfig.settings?.renderTextAs).toBe("image");
    expect(imageOnlyConfig.settings?.imageFormat).toEqual(["png"]);
  });

  it("computes validation state for empty, invalid, and ready selections", () => {
    const empty = createEmptySelectionSummary();
    expect(getValidationMessages(empty, null)).toEqual([]);
    expect(isExportBlocked(empty, null)).toBe(true);
    expect(selectionModeLabel(empty)).toBe("No eligible frames");
    expect(selectionSummaryCopy(empty)).toBe(
      "Select one or more top-level frames before exporting.",
    );
    expect(exportBlockedMessage(empty)).toBe(
      "Select one or more top-level frames before exporting.",
    );
    expect(shouldShowReadyStatus(empty, null)).toBe(false);

    const invalid = {
      ...empty,
      totalSelected: 2,
      frameNames: ["story:640", "story:640"],
      error: 'Responsive group "story" has duplicate width 640px.',
    };
    expect(getValidationMessages(invalid, null)).toEqual([
      'Responsive group "story" has duplicate width 640px.',
    ]);
    expect(selectionModeLabel(invalid)).toBe("Selection issue");
    expect(selectionSummaryCopy(invalid)).toBe("Selection needs attention before exporting.");
    expect(exportBlockedMessage(invalid)).toBe(
      'Responsive group "story" has duplicate width 640px.',
    );
    expect(shouldShowReadyStatus(invalid, null)).toBe(false);

    const ready = {
      totalSelected: 2,
      eligibleFrames: 2,
      frameNames: ["story:640", "story:960"],
      groupNames: ["story"],
      groups: [
        {
          name: "story",
          frameCount: 2,
          frameNames: ["story:640", "story:960"],
          widths: [640, 960],
          mode: "responsive" as const,
        },
      ],
      exportKind: "responsive" as const,
    };
    expect(getValidationMessages(ready, null)).toEqual([]);
    expect(isExportBlocked(ready, null)).toBe(false);
    expect(selectionModeLabel(ready)).toBe("Responsive group export");
    expect(selectionSummaryCopy(ready)).toBe("2 frames selected. 1 responsive group.");
    expect(shouldShowReadyStatus(ready, null)).toBe(true);
  });
});
