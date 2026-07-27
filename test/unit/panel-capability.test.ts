import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  capabilityNote,
  gateOptions,
  getControlCapability,
  isControlDisabledByCapability,
  isValueRequestable,
} from "../../plugins/illustrator/panel/src/js/capability.js";
import type { PanelSettingKey } from "../../plugins/illustrator/panel/src/shared/types.js";
import { illustratorCapabilities } from "../../src/core/capabilities.js";

const SECTIONS_DIR = join(process.cwd(), "plugins/illustrator/panel/src/js/sections");

describe("Illustrator panel capability gating", () => {
  it("reports settings with no declaration as fully honored", () => {
    expect(getControlCapability("responsiveness")).toEqual({
      status: "honored",
      requestable: true,
      allowedValues: null,
      note: "",
    });
    expect(capabilityNote("responsiveness")).toBeUndefined();
    expect(isControlDisabledByCapability("responsiveness")).toBe(false);
  });

  it("narrows imageFormat to the three values Illustrator actually produces", () => {
    const capability = getControlCapability("imageFormat");

    expect(capability.status).toBe("partial");
    // The control stays live: three of the five values are honest.
    expect(capability.requestable).toBe(true);
    expect(capability.allowedValues).toEqual(["auto", "png", "jpg"]);

    expect(isValueRequestable("imageFormat", "auto")).toBe(true);
    expect(isValueRequestable("imageFormat", "png")).toBe(true);
    expect(isValueRequestable("imageFormat", "jpg")).toBe(true);
    expect(isValueRequestable("imageFormat", "png24")).toBe(false);
    expect(isValueRequestable("imageFormat", "svg")).toBe(false);
  });

  it("disables the unhonored options instead of removing them", () => {
    const options = gateOptions("imageFormat", [
      { value: "auto", label: "Auto" },
      { value: "png", label: "PNG (8-bit)" },
      { value: "png24", label: "PNG (24-bit)" },
      { value: "jpg", label: "JPEG" },
      { value: "svg", label: "SVG" },
    ]);

    // A stored png24/svg value must still have something to display against.
    expect(options.map((option) => option.value)).toEqual(["auto", "png", "png24", "jpg", "svg"]);
    expect(options.filter((option) => option.disabled).map((option) => option.value)).toEqual([
      "png24",
      "svg",
    ]);
    expect(options.find((option) => option.value === "svg")?.label).toContain("not supported");
    expect(options.find((option) => option.value === "png")?.label).toBe("PNG (8-bit)");
  });

  it("disables controls for settings Illustrator does not read at all", () => {
    for (const key of ["inlineSvg", "svgIdPrefix"] as PanelSettingKey[]) {
      expect(isControlDisabledByCapability(key)).toBe(true);
      expect(capabilityNote(key)).toBe(illustratorCapabilities.settings[key].note);
      expect(capabilityNote(key)).toBeTruthy();
    }
  });

  it("re-enables the output control now that the export honors it", () => {
    // The gate is data-driven, so removing the `output` declaration is the whole
    // change: the panel select was disabled because the ExtendScript bundle could
    // not group artboards, and it groups them now. Asserted here because the
    // inverse — a live control for a setting nothing acts on — is the failure the
    // gate exists to prevent, and it has to be able to swing back.
    expect(illustratorCapabilities.settings.output).toBeUndefined();
    expect(isControlDisabledByCapability("output")).toBe(false);
    expect(capabilityNote("output")).toBeUndefined();
  });

  it("surfaces the declaration's own note, never a restatement of it", () => {
    expect(capabilityNote("imageFormat")).toBe(illustratorCapabilities.settings.imageFormat.note);
  });

  /**
   * The sweep guard. A control added tomorrow for a setting Illustrator does not
   * honor fails here, which is the failure mode the contract rule exists for.
   */
  it("routes every panel control for an unhonored setting through the gate", () => {
    const sources = readdirSync(SECTIONS_DIR)
      .filter((name) => name.endsWith(".svelte"))
      .map((name) => readFileSync(join(SECTIONS_DIR, name), "utf8"))
      .join("\n");

    const ungated: string[] = [];
    for (const [key, support] of Object.entries(illustratorCapabilities.settings)) {
      if (!sources.includes(`settings.${key}`)) continue;
      if (support.status === "honored" || support.warnedByEmitter) continue;
      const gated = support.values
        ? sources.includes(`gateOptions("${key}"`)
        : sources.includes(`isControlDisabledByCapability("${key}")`);
      if (!gated) ungated.push(key);
    }

    expect(ungated).toEqual([]);
  });
});
