/// <reference lib="dom" />

/**
 * Applies the Figma surface capability declaration to the plugin UI's controls.
 *
 * Kept out of `ui-entry.ts` because that module bootstraps itself on import;
 * this one is pure DOM-in/DOM-out so the gating can be asserted directly.
 *
 * Two rules drive everything here:
 *
 * 1. Gating constrains what the user can *request*. Nothing in this file writes
 *    to the shared config, so a value already stored in the JSONC — including
 *    one the runtime ignores — round-trips untouched.
 * 2. Unhonored options are disabled and labelled, never removed. An option that
 *    silently disappears reads as a deleted feature, and a stored value outside
 *    the honored subset would have nothing to display against.
 */

import { capabilityNote, getControlCapability, isValueRequestable } from "./capability.js";
import type { FigmaOutputFormat, FigmaPresetId } from "./types.js";
import { presetUnsupportedSettings } from "./ui.js";

/** Suffix appended to an option the surface will not produce. */
export const UNSUPPORTED_OPTION_SUFFIX = " — not supported";

/**
 * Every direct control, paired with the canonical setting key it edits.
 *
 * Data, not conditionals: a new `unsupported` entry in `figmaCapabilities`
 * gates its control with no change here.
 */
export const CONTROL_SETTING_SELECTORS: ReadonlyArray<{ key: string; selector: string }> = [
  { key: "projectName", selector: "[data-project-name]" },
  { key: "output", selector: "[data-output]" },
  { key: "responsiveness", selector: "[data-responsiveness]" },
  { key: "imageFormat", selector: "[data-image-format]" },
  { key: "renderTextAs", selector: "[data-render-text-as]" },
  { key: "renderRotatedSkewedTextAs", selector: "[data-render-rotated]" },
  { key: "googleFonts", selector: "[data-google-fonts]" },
  { key: "responsiveImageMode", selector: "[data-responsive-image-mode]" },
  { key: "centerHtmlOutput", selector: "[data-center-output]" },
];

const NON_PRESET_VALUES = new Set(["custom"]);

function setCapabilityNote(root: ParentNode, key: string, note: string): void {
  const target = root.querySelector<HTMLElement>(`[data-capability-note="${key}"]`);
  if (!target) return;
  target.textContent = note;
  target.hidden = note === "";
}

/** The option's label with any previously applied suffix stripped, memoized. */
function baseOptionLabel(option: HTMLOptionElement): string {
  if (option.dataset.baseLabel === undefined) {
    option.dataset.baseLabel = option.textContent ?? "";
  }
  return option.dataset.baseLabel;
}

function labelOption(option: HTMLOptionElement, supported: boolean): void {
  option.disabled = !supported;
  option.textContent = supported
    ? baseOptionLabel(option)
    : baseOptionLabel(option) + UNSUPPORTED_OPTION_SUFFIX;
}

function setTitle(element: HTMLElement, note: string): void {
  if (note) {
    element.title = note;
  } else {
    element.removeAttribute("title");
  }
}

function gatePresets(root: ParentNode, format: FigmaOutputFormat): void {
  const presetEl = root.querySelector<HTMLSelectElement>("[data-preset]");
  if (!presetEl) return;

  const notes: string[] = [];
  for (let i = 0; i < presetEl.options.length; i++) {
    const option = presetEl.options[i];
    if (NON_PRESET_VALUES.has(option.value)) continue;
    const unsupported = presetUnsupportedSettings(
      option.value as Exclude<FigmaPresetId, "custom">,
      { format },
    );
    const label = baseOptionLabel(option);
    labelOption(option, unsupported.length === 0);
    if (unsupported.length > 0) {
      notes.push(`${label} requests ${unsupported.join(", ")}.`);
    }
  }

  setCapabilityNote(
    root,
    "preset",
    notes.length === 0 ? "" : `${notes.join(" ")} The Figma runtime does not honor those settings.`,
  );
}

/**
 * Disable every control and option the Figma runtime will not act on, and show
 * the declaration's note as the explanation.
 *
 * Idempotent: safe to re-run whenever the targeted output format changes, which
 * is what `output` needs — the html emitter honors it and standalone does not.
 */
export function applyCapabilityGating(root: ParentNode, format: FigmaOutputFormat): void {
  const context = { format };

  for (const control of CONTROL_SETTING_SELECTORS) {
    const element = root.querySelector<HTMLSelectElement | HTMLInputElement>(control.selector);
    if (!element) continue;

    const capability = getControlCapability(control.key, context);
    const note = capabilityNote(control.key, context) ?? "";
    element.disabled = !capability.requestable;
    setTitle(element, note);

    const options = (element as HTMLSelectElement).options;
    if (options) {
      for (let i = 0; i < options.length; i++) {
        labelOption(options[i], isValueRequestable(control.key, options[i].value, context));
      }
    }

    setCapabilityNote(root, control.key, note);
  }

  gatePresets(root, format);
}
