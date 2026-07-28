/**
 * Capability gating for the Illustrator panel controls.
 *
 * The contract rule is "a surface must not accept a setting it does not honor";
 * the warning half already ships in `src/core/capabilities.ts`. This is the UI
 * half: the same declaration decides whether a control can be edited at all and
 * which of an enum control's options the user may actually request.
 *
 * The declaration is read, never restated. Adding a capability means editing
 * `illustratorCapabilities`, not this file.
 *
 * Gating is about what the user can *request*. It never rewrites stored config:
 * a value locked in by `ai2html-settings` still displays (and still round-trips
 * through save) on a disabled control.
 *
 * Direction of the import matters — panel ← core is safe. Nothing here may be
 * pulled into `src/extendscript/`.
 *
 * `illustratorCapabilities` is imported by name rather than resolved through
 * `getSurfaceCapabilities`, for the same reason the ExtendScript bundle does:
 * touching the registry array drags the Figma, CLI, and browser declarations
 * into the panel bundle, and rollup cannot tree-shake them back out.
 */

import {
  illustratorCapabilities as ILLUSTRATOR,
  type SettingSupport,
  type SettingSupportStatus,
} from "../../../../../src/core/capabilities.js";
import type { PanelSettingKey } from "../shared/types.js";

export interface ControlCapability {
  /** Resolved status, after falling back to the surface's `defaultStatus`. */
  status: SettingSupportStatus;
  /**
   * Whether the control may let the user pick a different value at all.
   * `false` means the control is rendered disabled with `note` as the reason.
   */
  requestable: boolean;
  /**
   * The enum subset this surface honors, or `null` when every value is honored.
   * Options outside the subset are shown disabled, not removed, so a config
   * that already carries one stays visible and explicable.
   */
  allowedValues: readonly string[] | null;
  /** What the surface does instead. Empty string when fully honored. */
  note: string;
}

const HONORED: ControlCapability = {
  status: "honored",
  requestable: true,
  allowedValues: null,
  note: "",
};

function supportFor(key: string): SettingSupport {
  const declared = ILLUSTRATOR.settings[key];
  if (declared) return declared;
  return { status: ILLUSTRATOR.defaultStatus, note: ILLUSTRATOR.defaultNote };
}

/** What the panel may let the user request for `key`. */
export function getControlCapability(key: PanelSettingKey): ControlCapability {
  const support = supportFor(key);

  if (support.status === "honored") return HONORED;

  if (support.status === "unsupported" || support.status === "na") {
    return { status: support.status, requestable: false, allowedValues: null, note: support.note };
  }

  // `partial`. Content-dependent gaps are the emitter's to warn about — the
  // setting is honored for some documents, so the control stays live.
  if (support.warnedByEmitter) {
    return { status: "partial", requestable: true, allowedValues: null, note: support.note };
  }
  if (support.values) {
    return {
      status: "partial",
      requestable: true,
      allowedValues: support.values,
      note: support.note,
    };
  }
  // Unqualified `partial` means only the surface's own behavior is honored,
  // which is what the checker warns about for any other value.
  return { status: "partial", requestable: false, allowedValues: null, note: support.note };
}

/** True when the user may request `value` for `key` on this surface. */
export function isValueRequestable(key: PanelSettingKey, value: string): boolean {
  const capability = getControlCapability(key);
  if (!capability.requestable) return false;
  if (!capability.allowedValues) return true;
  return capability.allowedValues.indexOf(value) !== -1;
}

export interface ControlOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Mark the options this surface will not produce as disabled rather than
 * dropping them: an option that silently disappears reads as a removed feature,
 * and a stored value outside the subset would have nothing to display against.
 */
export function gateOptions(key: PanelSettingKey, options: ControlOption[]): ControlOption[] {
  const capability = getControlCapability(key);
  if (!capability.allowedValues) return options;
  const allowed = capability.allowedValues;
  return options.map((option) =>
    allowed.indexOf(option.value) === -1
      ? { ...option, label: `${option.label} — not supported`, disabled: true }
      : option,
  );
}

/** The explanation to show beside a gated control, or `undefined` when clean. */
export function capabilityNote(key: PanelSettingKey): string | undefined {
  const capability = getControlCapability(key);
  if (capability.status === "honored") return undefined;
  return capability.note || undefined;
}

/** Keys whose control the panel must not let the user edit. */
export function isControlDisabledByCapability(key: PanelSettingKey): boolean {
  return !getControlCapability(key).requestable;
}
