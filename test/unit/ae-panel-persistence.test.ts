import { describe, expect, it } from "vitest";
import {
  normalizeAeConfigData,
  resolveAeStateLayers,
} from "../../plugins/illustrator/panel/src/js/ae-persistence.js";

describe("ae panel persistence", () => {
  it("merges app defaults and project config with project precedence", () => {
    const resolved = resolveAeStateLayers({
      appDefaults: {
        version: "1.0.0",
        settings: {
          overlayPrefix: "app:",
          outputRoot: "defaults-output",
          videoTemplate: "H.264",
        },
        fonts: [{ sourceFont: "ArialMT", family: "Arial" }],
      },
      config: {
        version: "1.0.0",
        settings: {
          overlayPrefix: "overlay:",
          targetCompId: "42",
          outputRoot: "project-output",
          posterTemplate: "PNG Sequence",
        },
        fonts: [{ aifont: "ArialMT", family: "Inter" }],
      },
    });

    expect(resolved.source).toBe("mixed");
    expect(resolved.settings.overlayPrefix).toBe("overlay:");
    expect(resolved.settings.targetCompId).toBe("42");
    expect(resolved.settings.outputRoot).toBe("project-output");
    expect(resolved.settings.videoTemplate).toBe("H.264");
    expect(resolved.settings.posterTemplate).toBe("PNG Sequence");
    expect(resolved.fonts).toEqual([
      {
        sourceFont: "ArialMT",
        aifont: "ArialMT",
        family: "Inter",
      },
    ]);
  });

  it("falls back to core defaults when no saved state exists", () => {
    const resolved = resolveAeStateLayers({});
    expect(resolved.source).toBe("core-defaults");
    expect(resolved.settings.overlayPrefix).toBe("overlay:");
    expect(resolved.settings.outputRoot).toBe("");
    expect(resolved.settings.videoTemplate).toBe("");
    expect(resolved.settings.posterTemplate).toBe("");
    expect(resolved.fonts).toEqual([]);
  });

  it("unwraps legacy double-encoded project config without dropping source or fonts", () => {
    const legacyEncodedConfig = JSON.stringify(
      JSON.stringify({
        version: "1.0.0",
        settings: {
          overlayPrefix: "legacy:",
          outputRoot: "legacy-output",
        },
        fonts: [{ aifont: "ArialMT", family: "Inter" }],
      }),
    );

    const normalized = normalizeAeConfigData(legacyEncodedConfig);
    expect(normalized).toEqual({
      version: "1.0.0",
      settings: {
        overlayPrefix: "legacy:",
        outputRoot: "legacy-output",
      },
      fonts: [
        {
          sourceFont: "ArialMT",
          aifont: "ArialMT",
          family: "Inter",
        },
      ],
    });

    const resolved = resolveAeStateLayers({
      config: legacyEncodedConfig,
    });

    expect(resolved.source).toBe("project-config");
    expect(resolved.settings.overlayPrefix).toBe("legacy:");
    expect(resolved.settings.outputRoot).toBe("legacy-output");
    expect(resolved.fonts).toEqual([
      {
        sourceFont: "ArialMT",
        aifont: "ArialMT",
        family: "Inter",
      },
    ]);
  });
});
