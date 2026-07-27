/**
 * Capability gating for the Figma plugin controls.
 *
 * The contract rule is "a surface must not accept a setting it does not honor";
 * `src/core/capabilities.ts` already warns at export time. This is the UI half:
 * the same declaration decides which controls the user can move and which enum
 * options they can pick, so the picker can no longer read "Image fallback"
 * while the export emits live HTML text.
 *
 * The declaration is read, never restated. Adding a capability means editing
 * `figmaCapabilities`, not this file.
 *
 * Gating constrains what the user can *request*. It never rewrites the shared
 * config: a value already stored in the JSONC (or written by hand in the
 * Advanced editor) still displays on a gated control and still round-trips.
 */

import {
  figmaCapabilities,
  type SettingSupport,
  type SettingSupportStatus,
} from "../../../src/core/capabilities.js";
import type { FigmaOutputFormat } from "./types.js";

export interface FigmaCapabilityContext {
  /** Emitter format the export is targeting; some settings are format-scoped. */
  format?: FigmaOutputFormat;
}

export interface ControlCapability {
  /** Resolved status, after falling back to the surface's `defaultStatus`. */
  status: SettingSupportStatus;
  /**
   * Whether the control may let the user pick a different value at all.
   * `false` means render it disabled, with `note` as the reason.
   */
  requestable: boolean;
  /**
   * The enum subset this surface honors, or `null` when every value is honored.
   * Options outside the subset are disabled rather than removed so a stored
   * value stays visible and explicable.
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
  const declared = figmaCapabilities.settings[key];
  if (declared) return declared;
  return { status: figmaCapabilities.defaultStatus, note: figmaCapabilities.defaultNote };
}

/** What the Figma UI may let the user request for `key`. */
export function getControlCapability(
  key: string,
  context: FigmaCapabilityContext = {},
): ControlCapability {
  const support = supportFor(key);

  if (support.status === "honored") return HONORED;

  if (support.status === "unsupported" || support.status === "na") {
    return { status: support.status, requestable: false, allowedValues: null, note: support.note };
  }

  // `partial`. Content-dependent gaps belong to the emitter that produces the
  // harm — the setting is honored for some documents, so the control stays live.
  if (support.warnedByEmitter) {
    return { status: "partial", requestable: true, allowedValues: null, note: support.note };
  }
  if (support.unsupportedFormats) {
    const blocked =
      context.format !== undefined && support.unsupportedFormats.indexOf(context.format) !== -1;
    return blocked
      ? { status: "partial", requestable: false, allowedValues: null, note: support.note }
      : HONORED;
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
  // which is exactly what the export checker warns about for any other value.
  return { status: "partial", requestable: false, allowedValues: null, note: support.note };
}

/** True when the user may request `value` for `key` on this surface. */
export function isValueRequestable(
  key: string,
  value: string,
  context: FigmaCapabilityContext = {},
): boolean {
  const capability = getControlCapability(key, context);
  if (!capability.requestable) return false;
  if (!capability.allowedValues) return true;
  return capability.allowedValues.indexOf(value) !== -1;
}

/** The explanation to show beside a gated control, or `null` when clean. */
export function capabilityNote(key: string, context: FigmaCapabilityContext = {}): string | null {
  const capability = getControlCapability(key, context);
  if (capability.status === "honored") return null;
  return capability.note || null;
}
