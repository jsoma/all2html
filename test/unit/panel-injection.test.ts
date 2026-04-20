import { describe, expect, it } from "vitest";

/**
 * Tests for the panel settings injection logic from exporter.jsx.
 *
 * The exporter runs in ExtendScript (not Node), so we can't import it directly.
 * Instead, we extract and test the merge logic as pure functions that simulate
 * what exporter.jsx does at lines ~1334-1384.
 *
 * Priority order (highest to lowest):
 *   1. Text block settings
 *   2. Panel settings
 *   3. Config file settings
 */

interface FontEntry {
  aifont: string;
  family: string;
  weight?: string;
  style?: string;
}

/**
 * Simulates the exporter resolution order from exporter.jsx:
 * start with config settings, overlay panel settings, then overlay text block settings.
 */
function resolveDocSettings(
  textBlockSettings: Record<string, string>,
  configSettings: Record<string, string>,
  panelSettings: Record<string, string>,
): Record<string, string> {
  return {
    ...configSettings,
    ...panelSettings,
    ...textBlockSettings,
  };
}

/**
 * Simulates the panel font injection from exporter.jsx:
 *
 *   for each panelFont:
 *     if matching aifont in configFonts: replace it
 *     else: push it
 */
function mergePanelFonts(configFonts: FontEntry[], panelFonts: FontEntry[]): void {
  for (const pf of panelFonts) {
    let found = false;
    for (let i = 0; i < configFonts.length; i++) {
      if (configFonts[i].aifont === pf.aifont) {
        configFonts[i] = pf;
        found = true;
        break;
      }
    }
    if (!found) {
      configFonts.push(pf);
    }
  }
}

describe("panel settings injection — merge priority", () => {
  it("panel settings fill gaps in empty docSettings", () => {
    const docSettings = resolveDocSettings(
      {},
      {},
      {
        image_format: "png",
        jpg_quality: "80",
        responsiveness: "dynamic",
      },
    );

    expect(docSettings).toEqual({
      image_format: "png",
      jpg_quality: "80",
      responsiveness: "dynamic",
    });
  });

  it("text block settings are NOT overridden by panel settings", () => {
    const docSettings = resolveDocSettings(
      {
        image_format: "jpg",
        responsiveness: "fixed",
      },
      {},
      {
        image_format: "png",
        responsiveness: "dynamic",
        jpg_quality: "80",
      },
    );

    expect(docSettings["image_format"]).toBe("jpg");
    expect(docSettings["responsiveness"]).toBe("fixed");
    expect(docSettings["jpg_quality"]).toBe("80");
  });

  it("panel settings override config file settings when text block is absent", () => {
    const docSettings = resolveDocSettings(
      {
        output: "one-file",
      },
      {
        image_format: "svg",
        max_width: "1200",
      },
      {
        image_format: "png",
        max_width: "600",
        jpg_quality: "80",
      },
    );

    expect(docSettings["output"]).toBe("one-file");
    expect(docSettings["image_format"]).toBe("png");
    expect(docSettings["max_width"]).toBe("600");
    expect(docSettings["jpg_quality"]).toBe("80");
  });

  it("panel provides values for keys not in text block or config", () => {
    const docSettings = resolveDocSettings(
      {
        output: "one-file",
      },
      {
        image_format: "jpg",
      },
      {
        testing_mode: "true",
        namespace: "custom-",
        center_html_output: "true",
      },
    );

    expect(docSettings["output"]).toBe("one-file");
    expect(docSettings["image_format"]).toBe("jpg");
    expect(docSettings["testing_mode"]).toBe("true");
    expect(docSettings["namespace"]).toBe("custom-");
    expect(docSettings["center_html_output"]).toBe("true");
  });

  it("full priority chain: text block > panel > config", () => {
    const docSettings = resolveDocSettings(
      {
        image_format: "from-text-block",
      },
      {
        image_format: "from-config",
      },
      {
        image_format: "from-panel",
      },
    );

    expect(docSettings["image_format"]).toBe("from-text-block");
  });

  it("panel wins over config when text block is absent", () => {
    const docSettings = resolveDocSettings(
      {},
      {
        image_format: "from-config",
      },
      {
        image_format: "from-panel",
      },
    );

    expect(docSettings["image_format"]).toBe("from-panel");
  });

  it("panel wins when both text block and config are absent for a key", () => {
    const docSettings = resolveDocSettings(
      {
        output: "one-file",
      },
      {
        namespace: "g-",
      },
      {
        jpg_quality: "90",
      },
    );

    expect(docSettings["jpg_quality"]).toBe("90");
  });

  it("empty panel settings produce no changes", () => {
    const docSettings = resolveDocSettings(
      {
        output: "one-file",
        image_format: "jpg",
      },
      {},
      {},
    );

    expect(docSettings).toEqual({
      output: "one-file",
      image_format: "jpg",
    });
  });

  it("empty config and panel leave text block settings unchanged", () => {
    const docSettings = resolveDocSettings(
      {
        output: "one-file",
        image_format: "png",
      },
      {},
      {},
    );

    expect(docSettings).toEqual({
      output: "one-file",
      image_format: "png",
    });
  });
});

describe("panel font injection", () => {
  it("replaces a matching aifont in config fonts", () => {
    const configFonts: FontEntry[] = [
      { aifont: "Arial-BoldMT", family: "Arial", weight: "700" },
      { aifont: "Georgia", family: "Georgia", weight: "400" },
    ];
    const panelFonts: FontEntry[] = [
      { aifont: "Arial-BoldMT", family: "Helvetica", weight: "700", style: "normal" },
    ];

    mergePanelFonts(configFonts, panelFonts);

    expect(configFonts).toHaveLength(2);
    expect(configFonts[0]).toEqual({
      aifont: "Arial-BoldMT",
      family: "Helvetica",
      weight: "700",
      style: "normal",
    });
    // Unmatched config font preserved
    expect(configFonts[1]).toEqual({
      aifont: "Georgia",
      family: "Georgia",
      weight: "400",
    });
  });

  it("appends a panel font with a new aifont not in config", () => {
    const configFonts: FontEntry[] = [{ aifont: "Arial-BoldMT", family: "Arial", weight: "700" }];
    const panelFonts: FontEntry[] = [
      { aifont: "TimesNewRomanPS-BoldMT", family: "Times New Roman", weight: "700" },
    ];

    mergePanelFonts(configFonts, panelFonts);

    expect(configFonts).toHaveLength(2);
    expect(configFonts[0].aifont).toBe("Arial-BoldMT");
    expect(configFonts[1]).toEqual({
      aifont: "TimesNewRomanPS-BoldMT",
      family: "Times New Roman",
      weight: "700",
    });
  });

  it("preserves config fonts that have no panel match", () => {
    const configFonts: FontEntry[] = [
      { aifont: "Arial-BoldMT", family: "Arial", weight: "700" },
      { aifont: "Georgia", family: "Georgia", weight: "400" },
      { aifont: "Courier", family: "Courier New", weight: "400" },
    ];
    const panelFonts: FontEntry[] = [{ aifont: "Georgia", family: "Noto Serif", weight: "400" }];

    mergePanelFonts(configFonts, panelFonts);

    expect(configFonts).toHaveLength(3);
    // Untouched
    expect(configFonts[0].family).toBe("Arial");
    // Replaced
    expect(configFonts[1].family).toBe("Noto Serif");
    // Untouched
    expect(configFonts[2].family).toBe("Courier New");
  });

  it("handles empty panel fonts (no-op)", () => {
    const configFonts: FontEntry[] = [{ aifont: "Arial-BoldMT", family: "Arial", weight: "700" }];
    const original = [...configFonts];

    mergePanelFonts(configFonts, []);

    expect(configFonts).toEqual(original);
  });

  it("handles empty config fonts — panel fonts are appended", () => {
    const configFonts: FontEntry[] = [];
    const panelFonts: FontEntry[] = [
      { aifont: "Arial-BoldMT", family: "Arial", weight: "700" },
      { aifont: "Georgia", family: "Georgia", weight: "400" },
    ];

    mergePanelFonts(configFonts, panelFonts);

    expect(configFonts).toHaveLength(2);
    expect(configFonts[0].aifont).toBe("Arial-BoldMT");
    expect(configFonts[1].aifont).toBe("Georgia");
  });

  it("handles multiple panel fonts: some replace, some append", () => {
    const configFonts: FontEntry[] = [
      { aifont: "Arial-BoldMT", family: "Arial", weight: "700" },
      { aifont: "Georgia", family: "Georgia", weight: "400" },
    ];
    const panelFonts: FontEntry[] = [
      // Replace existing
      { aifont: "Georgia", family: "Noto Serif", weight: "400" },
      // Append new
      { aifont: "Courier", family: "Courier New", weight: "400" },
    ];

    mergePanelFonts(configFonts, panelFonts);

    expect(configFonts).toHaveLength(3);
    expect(configFonts[0]).toEqual({ aifont: "Arial-BoldMT", family: "Arial", weight: "700" });
    expect(configFonts[1]).toEqual({ aifont: "Georgia", family: "Noto Serif", weight: "400" });
    expect(configFonts[2]).toEqual({ aifont: "Courier", family: "Courier New", weight: "400" });
  });
});
