/// <reference lib="dom" />

import type {
  FigmaDirectControls,
  FigmaOutputFormat,
  SandboxToUiMessage,
  UiToSandboxMessage,
} from "./types.js";
import {
  applyDirectControlsToConfig,
  buildLocalUiState,
  createEmptySelectionSummary,
  createInitialUiState,
  detectPresetFromControls,
  directControlsFromConfig,
  exportBlockedMessage,
  exportWarningNoticeCopy,
  getPresetControls,
  getValidationMessages,
  hydrateUiStateFromLocalState,
  isExportBlocked,
  parseConfigEditorText,
  selectionModeLabel,
  selectionSummaryCopy,
  serializePluginConfig,
  shouldShowReadyStatus,
} from "./ui.js";

declare global {
  interface Window {
    onmessage:
      | ((this: Window, ev: MessageEvent<{ pluginMessage: SandboxToUiMessage }>) => any)
      | null;
  }
}

function post(message: UiToSandboxMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function downloadZip(filename: string, bytes: Uint8Array): void {
  // Structured-cloned bytes are never SharedArrayBuffer-backed; the cast
  // only satisfies TS's ArrayBufferLike-generic Uint8Array default.
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface UiElements {
  selectionEl: HTMLElement;
  selectionModeEl: HTMLElement;
  validationEl: HTMLElement;
  exportNoticeEl: HTMLElement;
  exportNoticeTitleEl: HTMLElement;
  exportNoticeCopyEl: HTMLElement;
  configEl: HTMLTextAreaElement;
  presetEl: HTMLSelectElement;
  formatEl: HTMLSelectElement;
  outputEl: HTMLSelectElement;
  projectNameEl: HTMLInputElement;
  headlineEl: HTMLInputElement;
  altTextEl: HTMLTextAreaElement;
  imageAltTextEl: HTMLInputElement;
  ariaRoleEl: HTMLInputElement;
  responsivenessEl: HTMLSelectElement;
  imageFormatEl: HTMLSelectElement;
  renderTextAsEl: HTMLSelectElement;
  renderRotatedEl: HTMLSelectElement;
  googleFontsEl: HTMLSelectElement;
  responsiveImageModeEl: HTMLSelectElement;
  centerOutputEl: HTMLInputElement;
  statusEl: HTMLElement;
  saveButton: HTMLButtonElement;
  exportButton: HTMLButtonElement;
  resetConfigButton: HTMLButtonElement;
  resultPanelEl: HTMLElement;
  resultHeadlineEl: HTMLElement;
  resultEl: HTMLElement;
  advancedPanelEl: HTMLDetailsElement;
  moreSettingsPanelEl: HTMLDetailsElement;
}

function getRequiredElements(): UiElements {
  const selectionEl = document.querySelector<HTMLElement>("[data-selection]");
  const selectionModeEl = document.querySelector<HTMLElement>("[data-selection-mode]");
  const validationEl = document.querySelector<HTMLElement>("[data-validation]");
  const exportNoticeEl = document.querySelector<HTMLElement>("[data-export-notice]");
  const exportNoticeTitleEl = document.querySelector<HTMLElement>("[data-export-notice-title]");
  const exportNoticeCopyEl = document.querySelector<HTMLElement>("[data-export-notice-copy]");
  const configEl = document.querySelector<HTMLTextAreaElement>("[data-config]");
  const presetEl = document.querySelector<HTMLSelectElement>("[data-preset]");
  const formatEl = document.querySelector<HTMLSelectElement>("[data-format]");
  const outputEl = document.querySelector<HTMLSelectElement>("[data-output]");
  const projectNameEl = document.querySelector<HTMLInputElement>("[data-project-name]");
  const headlineEl = document.querySelector<HTMLInputElement>("[data-headline]");
  const altTextEl = document.querySelector<HTMLTextAreaElement>("[data-alt-text]");
  const imageAltTextEl = document.querySelector<HTMLInputElement>("[data-image-alt-text]");
  const ariaRoleEl = document.querySelector<HTMLInputElement>("[data-aria-role]");
  const responsivenessEl = document.querySelector<HTMLSelectElement>("[data-responsiveness]");
  const imageFormatEl = document.querySelector<HTMLSelectElement>("[data-image-format]");
  const renderTextAsEl = document.querySelector<HTMLSelectElement>("[data-render-text-as]");
  const renderRotatedEl = document.querySelector<HTMLSelectElement>("[data-render-rotated]");
  const googleFontsEl = document.querySelector<HTMLSelectElement>("[data-google-fonts]");
  const responsiveImageModeEl = document.querySelector<HTMLSelectElement>(
    "[data-responsive-image-mode]",
  );
  const centerOutputEl = document.querySelector<HTMLInputElement>("[data-center-output]");
  const statusEl = document.querySelector<HTMLElement>("[data-status]");
  const saveButton = document.querySelector<HTMLButtonElement>("[data-save]");
  const exportButton = document.querySelector<HTMLButtonElement>("[data-export]");
  const resetConfigButton = document.querySelector<HTMLButtonElement>("[data-reset-config]");
  const resultPanelEl = document.querySelector<HTMLElement>("[data-result-panel]");
  const resultHeadlineEl = document.querySelector<HTMLElement>("[data-result-headline]");
  const resultEl = document.querySelector<HTMLElement>("[data-result]");
  const advancedPanelEl = document.querySelector<HTMLDetailsElement>("[data-advanced-panel]");
  const moreSettingsPanelEl = document.querySelector<HTMLDetailsElement>(
    "[data-more-settings-panel]",
  );

  if (
    !selectionEl ||
    !selectionModeEl ||
    !validationEl ||
    !exportNoticeEl ||
    !exportNoticeTitleEl ||
    !exportNoticeCopyEl ||
    !configEl ||
    !presetEl ||
    !formatEl ||
    !outputEl ||
    !projectNameEl ||
    !headlineEl ||
    !altTextEl ||
    !imageAltTextEl ||
    !ariaRoleEl ||
    !responsivenessEl ||
    !imageFormatEl ||
    !renderTextAsEl ||
    !renderRotatedEl ||
    !googleFontsEl ||
    !responsiveImageModeEl ||
    !centerOutputEl ||
    !statusEl ||
    !saveButton ||
    !exportButton ||
    !resetConfigButton ||
    !resultPanelEl ||
    !resultHeadlineEl ||
    !resultEl ||
    !advancedPanelEl ||
    !moreSettingsPanelEl
  ) {
    throw new Error("Missing required Figma UI elements.");
  }

  return {
    selectionEl,
    selectionModeEl,
    validationEl,
    exportNoticeEl,
    exportNoticeTitleEl,
    exportNoticeCopyEl,
    configEl,
    presetEl,
    formatEl,
    outputEl,
    projectNameEl,
    headlineEl,
    altTextEl,
    imageAltTextEl,
    ariaRoleEl,
    responsivenessEl,
    imageFormatEl,
    renderTextAsEl,
    renderRotatedEl,
    googleFontsEl,
    responsiveImageModeEl,
    centerOutputEl,
    statusEl,
    saveButton,
    exportButton,
    resetConfigButton,
    resultPanelEl,
    resultHeadlineEl,
    resultEl,
    advancedPanelEl,
    moreSettingsPanelEl,
  };
}

function renderExportNotice(
  elements: UiElements,
  summary: ReturnType<typeof createInitialUiState>["exportSummary"],
): void {
  const notice = exportWarningNoticeCopy(summary?.warningCount ?? 0);
  if (!notice) {
    elements.exportNoticeEl.hidden = true;
    elements.exportNoticeTitleEl.textContent = "";
    elements.exportNoticeCopyEl.textContent = "";
    return;
  }

  elements.exportNoticeEl.hidden = false;
  elements.exportNoticeTitleEl.textContent = notice.title;
  elements.exportNoticeCopyEl.textContent = notice.detail;
}

function renderSelection(
  elements: UiElements,
  selection: ReturnType<typeof createInitialUiState>["selection"],
): void {
  elements.selectionModeEl.textContent = selectionModeLabel(selection);
  elements.selectionModeEl.className =
    selection.exportKind === "empty" && !selection.error
      ? "mode-chip"
      : "mode-chip mode-chip-active";

  elements.selectionEl.innerHTML = `
    <p class="${selection.error ? "validation-error" : selection.eligibleFrames === 0 ? "empty-state" : "helper"}">${escapeHtml(selectionSummaryCopy(selection))}</p>
  `;
}

function renderValidation(
  elements: UiElements,
  state: ReturnType<typeof createInitialUiState>,
): void {
  const messages = getValidationMessages(state.selection, state.configError);

  if (messages.length === 0) {
    elements.validationEl.innerHTML = "";
    return;
  }

  elements.validationEl.innerHTML = messages
    .map((message) => `<p class="validation-error">${escapeHtml(message)}</p>`)
    .join("");
}

function renderExportSummary(
  elements: UiElements,
  summary: ReturnType<typeof createInitialUiState>["exportSummary"],
  warnings: string[],
): void {
  if (!summary) {
    elements.resultPanelEl.hidden = false;
    elements.resultHeadlineEl.textContent = "";
    elements.resultEl.innerHTML = `<li class="result-item">No previous export.</li>`;
    return;
  }

  elements.resultHeadlineEl.textContent = `${summary.zipFilename} ready`;
  const fileItems =
    summary.files.length === 0
      ? "<li>none</li>"
      : summary.files.map((file) => `<li>${escapeHtml(file)}</li>`).join("");
  const warningItems =
    warnings.length === 0
      ? "<li>none</li>"
      : warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");

  elements.resultEl.innerHTML = `
    <li class="result-item"><strong>Format:</strong> ${summary.format === "html" ? "HTML" : "Standalone HTML"}</li>
    <li class="result-item">
      <strong>Files:</strong> ${summary.fileCount}
      <ul class="result-sublist">${fileItems}</ul>
    </li>
    <li class="result-item${warnings.length > 0 ? " result-item-warning" : ""}">
      <strong>Warnings:</strong> ${summary.warningCount}
      <ul class="result-sublist">${warningItems}</ul>
    </li>
  `;
}

function renderStatus(
  target: HTMLElement,
  message: string,
  tone: "info" | "error" | "success" = "info",
): void {
  target.className =
    tone === "error"
      ? "status status-error"
      : tone === "success"
        ? "status status-success"
        : "status";
  target.textContent = message;
}

function readControls(elements: UiElements): FigmaDirectControls {
  return {
    projectName: elements.projectNameEl.value,
    output: elements.outputEl.value === "multiple-files" ? "multiple-files" : "one-file",
    headline: elements.headlineEl.value,
    altText: elements.altTextEl.value,
    imageAltText: elements.imageAltTextEl.value,
    ariaRole: elements.ariaRoleEl.value,
    responsiveness: elements.responsivenessEl.value === "dynamic" ? "dynamic" : "fixed",
    imageFormat: (elements.imageFormatEl.value as FigmaDirectControls["imageFormat"]) || "auto",
    centerHtmlOutput: elements.centerOutputEl.checked,
    renderTextAs: elements.renderTextAsEl.value === "image" ? "image" : "html",
    renderRotatedSkewedTextAs: elements.renderRotatedEl.value === "image" ? "image" : "html",
    googleFonts:
      elements.googleFontsEl.value === "import" || elements.googleFontsEl.value === "link"
        ? elements.googleFontsEl.value
        : "none",
    responsiveImageMode: elements.responsiveImageModeEl.value === "css-var" ? "css-var" : "img-src",
  };
}

function writeControls(elements: UiElements, controls: FigmaDirectControls): void {
  elements.projectNameEl.value = controls.projectName;
  elements.outputEl.value = controls.output;
  elements.headlineEl.value = controls.headline;
  elements.altTextEl.value = controls.altText;
  elements.imageAltTextEl.value = controls.imageAltText;
  elements.ariaRoleEl.value = controls.ariaRole;
  elements.responsivenessEl.value = controls.responsiveness;
  elements.imageFormatEl.value = controls.imageFormat;
  elements.centerOutputEl.checked = controls.centerHtmlOutput;
  elements.renderTextAsEl.value = controls.renderTextAs;
  elements.renderRotatedEl.value = controls.renderRotatedSkewedTextAs;
  elements.googleFontsEl.value = controls.googleFonts;
  elements.responsiveImageModeEl.value = controls.responsiveImageMode;
}

function persistLocalUiState(state: ReturnType<typeof createInitialUiState>): void {
  post({ type: "save-local-ui-state", localState: buildLocalUiState(state) });
}

function updateConfigFromControls(
  elements: UiElements,
  state: ReturnType<typeof createInitialUiState>,
): void {
  const controls = readControls(elements);
  state.preset = detectPresetFromControls(controls);
  elements.presetEl.value = state.preset;
  state.parsedConfig = applyDirectControlsToConfig(state.parsedConfig, controls);
  state.configText = serializePluginConfig(state.parsedConfig);
  state.configError = null;
  elements.configEl.value = state.configText;
}

function applyConfigTextToState(
  elements: UiElements,
  state: ReturnType<typeof createInitialUiState>,
  configText: string,
): void {
  state.configText = configText;
  const parsed = parseConfigEditorText(configText);
  state.configError = parsed.configError;
  if (!parsed.configError) {
    state.parsedConfig = parsed.parsedConfig;
    const controls = directControlsFromConfig(parsed.parsedConfig);
    writeControls(elements, controls);
    state.preset = detectPresetFromControls(controls);
    elements.presetEl.value = state.preset;
  }
}

function syncButtons(elements: UiElements, state: ReturnType<typeof createInitialUiState>): void {
  const blocked = isExportBlocked(state.selection, state.configError);
  elements.saveButton.disabled = Boolean(state.configError);
  elements.exportButton.disabled = blocked || state.exporting;
}

export function bootstrapUi(): void {
  const elements = getRequiredElements();
  const state = createInitialUiState(createEmptySelectionSummary());

  renderSelection(elements, state.selection);
  renderValidation(elements, state);
  renderExportSummary(elements, state.exportSummary, state.warnings);
  renderExportNotice(elements, state.exportSummary);
  renderStatus(elements.statusEl, "Loading selection and shared config...");
  syncButtons(elements, state);

  elements.formatEl.addEventListener("change", () => {
    state.format = elements.formatEl.value === "standalone" ? "standalone" : "html";
    persistLocalUiState(state);
  });

  elements.presetEl.addEventListener("change", () => {
    const preset = elements.presetEl.value;
    if (
      preset !== "standard-story" &&
      preset !== "responsive-story" &&
      preset !== "image-only-graphic" &&
      preset !== "custom"
    ) {
      return;
    }
    state.preset = preset;
    if (preset !== "custom") {
      writeControls(elements, getPresetControls(preset));
      updateConfigFromControls(elements, state);
      renderValidation(elements, state);
      syncButtons(elements, state);
      renderStatus(
        elements.statusEl,
        `${elements.presetEl.selectedOptions[0]?.textContent ?? "Preset"} applied.`,
      );
    }
    persistLocalUiState(state);
  });

  elements.advancedPanelEl.addEventListener("toggle", () => {
    state.advancedOpen = elements.advancedPanelEl.open;
    persistLocalUiState(state);
  });

  elements.moreSettingsPanelEl.addEventListener("toggle", () => {
    state.moreSettingsOpen = elements.moreSettingsPanelEl.open;
    persistLocalUiState(state);
  });

  const directControlElements: Array<HTMLElement> = [
    elements.outputEl,
    elements.projectNameEl,
    elements.headlineEl,
    elements.altTextEl,
    elements.imageAltTextEl,
    elements.ariaRoleEl,
    elements.responsivenessEl,
    elements.imageFormatEl,
    elements.renderTextAsEl,
    elements.renderRotatedEl,
    elements.googleFontsEl,
    elements.responsiveImageModeEl,
    elements.centerOutputEl,
  ];

  for (const element of directControlElements) {
    element.addEventListener("input", () => {
      updateConfigFromControls(elements, state);
      renderValidation(elements, state);
      syncButtons(elements, state);
      persistLocalUiState(state);
      renderStatus(elements.statusEl, "Settings updated.");
    });
    element.addEventListener("change", () => {
      updateConfigFromControls(elements, state);
      renderValidation(elements, state);
      syncButtons(elements, state);
      persistLocalUiState(state);
      renderStatus(elements.statusEl, "Settings updated.");
    });
  }

  elements.configEl.addEventListener("input", () => {
    applyConfigTextToState(elements, state, elements.configEl.value);
    renderValidation(elements, state);
    syncButtons(elements, state);
    if (!state.configError) {
      persistLocalUiState(state);
    }
    renderStatus(
      elements.statusEl,
      state.configError ? "Advanced JSONC has errors." : "Advanced JSONC is valid.",
      state.configError ? "error" : "info",
    );
  });

  elements.resetConfigButton.addEventListener("click", () => {
    updateConfigFromControls(elements, state);
    renderValidation(elements, state);
    syncButtons(elements, state);
    persistLocalUiState(state);
    renderStatus(elements.statusEl, "Advanced JSONC reset to match the form.");
  });

  elements.saveButton.addEventListener("click", () => {
    if (state.configError) {
      renderStatus(elements.statusEl, state.configError, "error");
      return;
    }
    renderStatus(elements.statusEl, "Saving shared config...");
    post({ type: "save-config", configText: state.configText });
  });

  elements.exportButton.addEventListener("click", () => {
    if (state.exporting) {
      return;
    }
    if (state.configError) {
      renderStatus(elements.statusEl, state.configError, "error");
      return;
    }
    if (state.selection.error || state.selection.eligibleFrames === 0) {
      renderStatus(elements.statusEl, exportBlockedMessage(state.selection), "error");
      return;
    }
    state.exporting = true;
    syncButtons(elements, state);
    renderStatus(elements.statusEl, "Exporting selected frames...");
    post({
      type: "export",
      configText: state.configText,
      format: state.format,
    });
  });

  window.onmessage = (event) => {
    const pluginMessage = event.data?.pluginMessage;
    if (!pluginMessage) return;

    switch (pluginMessage.type) {
      case "selection-summary":
        state.selection = pluginMessage.selection;
        renderSelection(elements, state.selection);
        renderValidation(elements, state);
        syncButtons(elements, state);
        renderExportNotice(elements, state.exportSummary);
        if (shouldShowReadyStatus(pluginMessage.selection, state.configError)) {
          renderStatus(elements.statusEl, "Ready.");
        } else if (pluginMessage.selection.error) {
          renderStatus(elements.statusEl, pluginMessage.selection.error, "error");
        } else if (pluginMessage.selection.eligibleFrames === 0) {
          renderStatus(elements.statusEl, "Select one or more top-level frames before exporting.");
        }
        break;
      case "config-loaded": {
        hydrateUiStateFromLocalState(state, pluginMessage.localState);
        const localPreset = state.preset;
        elements.presetEl.value = state.preset;
        elements.formatEl.value = state.format;
        elements.advancedPanelEl.open = state.advancedOpen;
        elements.moreSettingsPanelEl.open = state.moreSettingsOpen;
        applyConfigTextToState(elements, state, pluginMessage.configText);
        if (!pluginMessage.configText.trim() && localPreset !== "custom") {
          state.preset = localPreset;
          elements.presetEl.value = state.preset;
          writeControls(elements, getPresetControls(localPreset));
          updateConfigFromControls(elements, state);
        }
        elements.configEl.value = state.configText;
        renderValidation(elements, state);
        syncButtons(elements, state);
        renderExportNotice(elements, state.exportSummary);
        renderStatus(elements.statusEl, "Shared config loaded.");
        break;
      }
      case "config-saved":
        applyConfigTextToState(elements, state, pluginMessage.configText);
        elements.configEl.value = state.configText;
        renderValidation(elements, state);
        syncButtons(elements, state);
        renderExportNotice(elements, state.exportSummary);
        renderStatus(elements.statusEl, "Shared config saved.", "success");
        break;
      case "export-success":
        state.exporting = false;
        syncButtons(elements, state);
        state.warnings = pluginMessage.warnings;
        state.exportSummary = {
          format: pluginMessage.format,
          fileCount: pluginMessage.fileCount,
          files: pluginMessage.files,
          warningCount: pluginMessage.warningCount,
          zipFilename: pluginMessage.zipFilename,
        };
        renderExportSummary(elements, state.exportSummary, state.warnings);
        renderExportNotice(elements, state.exportSummary);
        downloadZip(pluginMessage.zipFilename, pluginMessage.zipBytes);
        renderStatus(
          elements.statusEl,
          `Exported ${pluginMessage.zipFilename} (${pluginMessage.fileCount} file(s), ${pluginMessage.warningCount} warning(s)).`,
          "success",
        );
        break;
      case "export-error":
        state.exporting = false;
        syncButtons(elements, state);
        renderExportNotice(elements, state.exportSummary);
        renderStatus(
          elements.statusEl,
          pluginMessage.details?.length
            ? `${pluginMessage.message} ${pluginMessage.details.join(" ")}`
            : pluginMessage.message,
          "error",
        );
        break;
    }
  };

  post({ type: "get-selection-summary" });
  post({ type: "load-config" });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      bootstrapUi();
    });
  } else {
    bootstrapUi();
  }
}
