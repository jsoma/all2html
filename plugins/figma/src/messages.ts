import type { SandboxToUiMessage, UiToSandboxMessage } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isUiToSandboxMessage(value: unknown): value is UiToSandboxMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "get-selection-summary":
    case "load-config":
      return true;
    case "save-local-ui-state":
      return (
        isRecord(value.localState) &&
        (value.localState.format === "html" || value.localState.format === "standalone") &&
        typeof value.localState.advancedOpen === "boolean" &&
        typeof value.localState.moreSettingsOpen === "boolean" &&
        (value.localState.preset === "standard-story" ||
          value.localState.preset === "responsive-story" ||
          value.localState.preset === "image-only-graphic" ||
          value.localState.preset === "custom")
      );
    case "save-config":
      return typeof value.configText === "string";
    case "export":
      return (
        typeof value.configText === "string" &&
        (value.format === "html" || value.format === "standalone")
      );
    default:
      return false;
  }
}

export function toPluginMessage(message: SandboxToUiMessage): { pluginMessage: SandboxToUiMessage } {
  return { pluginMessage: message };
}
