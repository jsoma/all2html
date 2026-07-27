// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  capabilityNote,
  getControlCapability,
  isValueRequestable,
} from "../../plugins/figma/src/capability.js";
import type { FigmaOutputFormat } from "../../plugins/figma/src/types.js";
import {
  applyDirectControlsToConfig,
  directControlsFromConfig,
  isPresetRequestable,
  presetUnsupportedSettings,
} from "../../plugins/figma/src/ui.js";
import {
  applyCapabilityGating,
  CONTROL_SETTING_SELECTORS,
} from "../../plugins/figma/src/ui-capability-dom.js";
import { figmaCapabilities } from "../../src/core/capabilities.js";

const UI_HTML = readFileSync(join(process.cwd(), "plugins/figma/src/ui.html"), "utf8");
const BODY = UI_HTML.slice(UI_HTML.indexOf("<body>") + "<body>".length, UI_HTML.indexOf("</body>"));

function mountUi(format: FigmaOutputFormat = "html"): Document {
  document.body.innerHTML = BODY;
  applyCapabilityGating(document, format);
  return document;
}

function select(selector: string): HTMLSelectElement {
  const element = document.querySelector<HTMLSelectElement>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function optionState(selector: string): Record<string, boolean> {
  const element = select(selector);
  const state: Record<string, boolean> = {};
  for (let i = 0; i < element.options.length; i++) {
    state[element.options[i].value] = element.options[i].disabled;
  }
  return state;
}

function noteText(key: string): string {
  return document.querySelector<HTMLElement>(`[data-capability-note="${key}"]`)?.textContent ?? "";
}

describe("Figma capability helper", () => {
  it("reports undeclared settings as fully honored", () => {
    expect(getControlCapability("responsiveness")).toEqual({
      status: "honored",
      requestable: true,
      allowedValues: null,
      note: "",
    });
    expect(capabilityNote("responsiveness")).toBeNull();
  });

  it("narrows imageFormat to the two values the Figma runtime produces", () => {
    expect(getControlCapability("imageFormat").allowedValues).toEqual(["auto", "png24"]);
    expect(isValueRequestable("imageFormat", "png24")).toBe(true);
    expect(isValueRequestable("imageFormat", "png")).toBe(false);
    expect(isValueRequestable("imageFormat", "jpg")).toBe(false);
    expect(isValueRequestable("imageFormat", "svg")).toBe(false);
  });

  it("treats the always-live-HTML text settings as unrequestable", () => {
    for (const key of ["renderTextAs", "renderRotatedSkewedTextAs"]) {
      expect(getControlCapability(key).requestable).toBe(false);
      expect(capabilityNote(key)).toBe(figmaCapabilities.settings[key].note);
    }
  });

  it("scopes format-qualified settings to the format actually selected", () => {
    // `htmlOutputExtension` is honored by the html emitter and ignored by
    // standalone, so the same key answers differently per targeted format.
    // This is why the gating is re-applied whenever the format picker moves.
    expect(figmaCapabilities.settings.htmlOutputExtension.unsupportedFormats).toContain(
      "standalone",
    );
    expect(getControlCapability("htmlOutputExtension", { format: "html" }).requestable).toBe(true);
    expect(capabilityNote("htmlOutputExtension", { format: "html" })).toBeNull();
    expect(getControlCapability("htmlOutputExtension", { format: "standalone" }).requestable).toBe(
      false,
    );
    expect(capabilityNote("htmlOutputExtension", { format: "standalone" })).toBe(
      figmaCapabilities.settings.htmlOutputExtension.note,
    );
  });
});

describe("Figma preset gating", () => {
  it("rejects the preset that asks for three things Figma never does", () => {
    expect(presetUnsupportedSettings("image-only-graphic")).toEqual([
      "imageFormat",
      "renderTextAs",
      "renderRotatedSkewedTextAs",
    ]);
    expect(isPresetRequestable("image-only-graphic")).toBe(false);
  });

  it("keeps the presets whose changes the runtime honors", () => {
    expect(presetUnsupportedSettings("standard-story")).toEqual([]);
    expect(presetUnsupportedSettings("responsive-story")).toEqual([]);
    expect(isPresetRequestable("custom")).toBe(true);
  });
});

describe("Figma UI capability gating", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("disables the image formats the runtime cannot produce, without removing them", () => {
    mountUi();

    expect(optionState("[data-image-format]")).toEqual({
      auto: false,
      png: true,
      png24: false,
      jpg: true,
      svg: true,
    });
    expect(select("[data-image-format]").disabled).toBe(false);
    expect(noteText("imageFormat")).toBe(figmaCapabilities.settings.imageFormat.note);
  });

  it("disables the text-rendering pickers that used to promise an image fallback", () => {
    mountUi();

    for (const selector of ["[data-render-text-as]", "[data-render-rotated]"]) {
      const element = select(selector);
      expect(element.disabled).toBe(true);
      // The option a user could previously pick is now visibly unavailable.
      expect(element.querySelector<HTMLOptionElement>('option[value="image"]')?.disabled).toBe(
        true,
      );
      expect(element.title).toContain("live HTML");
    }
    expect(noteText("renderTextAs")).toBe(figmaCapabilities.settings.renderTextAs.note);
  });

  it("re-answers every control when the targeted format changes", () => {
    // `output` is honored on both formats today. The gate is still evaluated
    // per format so a future format-scoped declaration needs no wiring change.
    for (const format of ["html", "standalone"] as const) {
      mountUi(format);
      for (const control of CONTROL_SETTING_SELECTORS) {
        const element = select(control.selector);
        expect(element.disabled, `${control.key} @ ${format}`).toBe(
          !getControlCapability(control.key, { format }).requestable,
        );
        expect(noteText(control.key), `${control.key} @ ${format}`).toBe(
          capabilityNote(control.key, { format }) ?? "",
        );
      }
    }
  });

  it("leaves honored controls untouched", () => {
    mountUi();

    expect(select("[data-responsiveness]").disabled).toBe(false);
    expect(select("[data-google-fonts]").disabled).toBe(false);
    expect(optionState("[data-google-fonts]")).toEqual({
      none: false,
      import: false,
      link: false,
    });
    expect(select("[data-responsiveness]").hasAttribute("title")).toBe(false);
  });

  it("disables the preset that would request unhonored settings", () => {
    mountUi();

    const preset = select("[data-preset]");
    expect(optionState("[data-preset]")).toEqual({
      "standard-story": false,
      "responsive-story": false,
      "image-only-graphic": true,
      custom: false,
    });
    expect(
      preset.querySelector<HTMLOptionElement>('option[value="image-only-graphic"]')?.textContent,
    ).toContain("not supported");
    expect(noteText("preset")).toContain("renderTextAs");
  });

  it("is idempotent, so re-running on a format change does not stack labels", () => {
    mountUi("html");
    applyCapabilityGating(document, "standalone");
    applyCapabilityGating(document, "html");

    const svg =
      select("[data-image-format]").querySelector<HTMLOptionElement>('option[value="svg"]');
    expect(svg?.textContent).toBe("SVG — not supported");
  });

  it("never rewrites a stored config value the runtime ignores", () => {
    mountUi();

    // A doc-locked / hand-written value outside the honored subset stays put:
    // gating decides what can be requested, not what is stored.
    const stored = {
      settings: { imageFormat: ["svg" as const], renderTextAs: "image" as const },
    };
    const controls = directControlsFromConfig(stored);
    expect(controls.imageFormat).toBe("svg");
    expect(controls.renderTextAs).toBe("image");

    select("[data-image-format]").value = "svg";
    select("[data-render-text-as]").value = "image";
    expect(select("[data-image-format]").value).toBe("svg");
    expect(select("[data-render-text-as]").value).toBe("image");

    expect(applyDirectControlsToConfig(stored, controls).settings).toMatchObject({
      imageFormat: ["svg"],
      renderTextAs: "image",
    });
  });

  it("covers every direct control with a declared setting key", () => {
    mountUi();

    for (const control of CONTROL_SETTING_SELECTORS) {
      expect(document.querySelector(control.selector), control.selector).not.toBeNull();
    }
  });
});
