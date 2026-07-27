/// <reference lib="dom" />

import wasmUrl from "@resvg/resvg-wasm/index_bg.wasm?url";
import {
  type BrowserSvgConversionResult,
  bundleToZipBytes,
  convertLoadedSvgFilesInBrowser,
  createBrowserSvgRasterizer,
  createOutputBundle,
  getBrowserEmitter,
  getBundleFile,
  importSVGFilesWithRasterizer,
  type LoadedSVGImportFiles,
  loadSVGImportFilesFromBrowser,
  type OutputBundle,
  parseConfigText,
  processDocumentInBrowser,
  type SvgRasterizer,
} from "../../../src/browser.js";
import "./styles.css";

type SupportedFormat = "html" | "standalone" | "svelte" | "react";

interface RunState {
  loaded: LoadedSVGImportFiles;
  bundle: OutputBundle;
  emittedPath: string;
  format: SupportedFormat;
  slug: string;
  importWarnings: string[];
  renderWarnings: string[];
  artboardSummary: string[];
  fileSummary: string[];
}

interface AppDependencies {
  createRasterizer(): Promise<SvgRasterizer>;
  loadFiles(files: Iterable<File> | FileList): Promise<LoadedSVGImportFiles>;
  parseConfig(text: string, sourceLabel: string): ReturnType<typeof parseConfigText>;
  importFiles: typeof importSVGFilesWithRasterizer;
  process: typeof processDocumentInBrowser;
  emitter: typeof getBrowserEmitter;
  buildBundle: typeof createOutputBundle;
  convert: typeof convertLoadedSvgFilesInBrowser;
  zipBundle: typeof bundleToZipBytes;
  download(name: string, bytes: Uint8Array): void;
}

const defaultDependencies: AppDependencies = {
  async createRasterizer() {
    return createBrowserSvgRasterizer({
      wasm: fetch(wasmUrl),
    });
  },
  loadFiles: loadSVGImportFilesFromBrowser,
  parseConfig: parseConfigText,
  importFiles: importSVGFilesWithRasterizer,
  process: processDocumentInBrowser,
  emitter: getBrowserEmitter,
  buildBundle: createOutputBundle,
  convert: convertLoadedSvgFilesInBrowser,
  zipBundle: bundleToZipBytes,
  download(name, bytes) {
    const blob = new Blob([toArrayBuffer(bytes)], { type: "application/zip" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 0);
  },
};

export function mountSvgDropzoneApp(
  root: HTMLElement,
  dependencies: Partial<AppDependencies> = {},
): void {
  const deps: AppDependencies = { ...defaultDependencies, ...dependencies };
  const state = {
    files: [] as File[],
    configFile: null as File | null,
    isDragging: false,
    currentRun: null as RunState | null,
  };

  root.innerHTML = `
    <div class="shell">
      <section class="hero">
        <h1>SVG in. HTML, React, Svelte, and standalone out.</h1>
        <p>Drop a single SVG, a multi-file SVG export, or a ZIP of SVGs. The browser path uses the same all2html importer core as the CLI, with raster backgrounds generated client-side through resvg-wasm.</p>
      </section>
      <div class="grid">
        <section class="panel">
          <div class="dropzone" data-dropzone>
            <h2>Source</h2>
            <p>Drop SVGs or a ZIP here, or pick files manually. Folder uploads work when the picker supports <code>webkitdirectory</code>.</p>
            <div class="button-row">
              <button class="button" type="button" data-pick-files>Choose files</button>
              <button class="secondary-button" type="button" data-pick-folder>Choose folder</button>
            </div>
            <input data-file-input type="file" multiple hidden accept=".svg,.zip,image/*" />
            <input data-folder-input type="file" multiple webkitdirectory hidden />
            <p class="meta" data-selection>Nothing selected.</p>
          </div>

          <div class="panel-section">
            <h2>Options</h2>
            <div class="field">
              <label for="format-select">Output format</label>
              <select id="format-select" data-format>
                <option value="html">HTML fragment</option>
                <option value="standalone">Standalone HTML</option>
                <option value="svelte">Svelte</option>
                <option value="react">React</option>
              </select>
            </div>
            <div class="field">
              <label for="slug-input">Project slug override</label>
              <input id="slug-input" data-slug placeholder="Optional" />
            </div>
            <div class="field">
              <label for="config-input">Optional config file</label>
              <input id="config-input" data-config-input type="file" accept=".json,.jsonc" />
            </div>
            <div class="button-row" style="margin-top: 14px;">
              <button class="button" type="button" data-generate>Generate</button>
              <button class="secondary-button" type="button" data-reset>Reset</button>
              <button class="download-link is-disabled" type="button" data-download>Download bundle</button>
            </div>
          </div>

          <div class="panel-section">
            <h2>Summary</h2>
            <ul class="summary-list" data-summary>
              <li>No import has been run yet.</li>
            </ul>
          </div>

          <div class="panel-section">
            <h2>Warnings</h2>
            <ul class="warning-list" data-warnings>
              <li>No warnings.</li>
            </ul>
          </div>
        </section>

        <section class="viewer">
          <div class="viewer-header">
            <div>
              <h2>Output</h2>
              <div class="meta" data-viewer-meta>No output generated yet.</div>
            </div>
            <div class="viewer-toolbar">
              <label>
                <span class="meta">File</span><br />
                <select data-output-file></select>
              </label>
            </div>
          </div>
          <div class="viewer-body" data-viewer-body>
            <div class="empty-state">Pick files, choose an output format, then generate a client-side bundle.</div>
          </div>
        </section>
      </div>
    </div>
  `;

  const dropzone = root.querySelector<HTMLElement>("[data-dropzone]")!;
  const fileInput = root.querySelector<HTMLInputElement>("[data-file-input]")!;
  const folderInput = root.querySelector<HTMLInputElement>("[data-folder-input]")!;
  const configInput = root.querySelector<HTMLInputElement>("[data-config-input]")!;
  const selectionLabel = root.querySelector<HTMLElement>("[data-selection]")!;
  const formatSelect = root.querySelector<HTMLSelectElement>("[data-format]")!;
  const slugInput = root.querySelector<HTMLInputElement>("[data-slug]")!;
  const summaryList = root.querySelector<HTMLElement>("[data-summary]")!;
  const warningList = root.querySelector<HTMLElement>("[data-warnings]")!;
  const viewerMeta = root.querySelector<HTMLElement>("[data-viewer-meta]")!;
  const viewerBody = root.querySelector<HTMLElement>("[data-viewer-body]")!;
  const outputFileSelect = root.querySelector<HTMLSelectElement>("[data-output-file]")!;
  const downloadButton = root.querySelector<HTMLButtonElement>("[data-download]")!;

  root
    .querySelector<HTMLElement>("[data-pick-files]")!
    .addEventListener("click", () => fileInput.click());
  root
    .querySelector<HTMLElement>("[data-pick-folder]")!
    .addEventListener("click", () => folderInput.click());
  root.querySelector<HTMLElement>("[data-generate]")!.addEventListener("click", async () => {
    await generate();
  });
  root.querySelector<HTMLElement>("[data-reset]")!.addEventListener("click", () => {
    state.files = [];
    state.configFile = null;
    state.currentRun = null;
    fileInput.value = "";
    folderInput.value = "";
    configInput.value = "";
    slugInput.value = "";
    setDragging(false);
    renderSelection();
    renderRunState();
  });
  downloadButton.addEventListener("click", () => {
    if (!state.currentRun) return;
    const bytes = deps.zipBundle(state.currentRun.bundle);
    deps.download(`${state.currentRun.slug || "svg-import"}.zip`, bytes);
  });
  outputFileSelect.addEventListener("change", () => renderRunState());

  fileInput.addEventListener("change", () => {
    state.files = Array.from(fileInput.files || []);
    renderSelection();
  });
  folderInput.addEventListener("change", () => {
    state.files = Array.from(folderInput.files || []);
    renderSelection();
  });
  configInput.addEventListener("change", () => {
    state.configFile = configInput.files?.[0] ?? null;
    renderSelection();
  });

  for (const eventName of ["dragenter", "dragover"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      setDragging(true);
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (eventName === "drop") {
        const droppedFiles = Array.from((event as DragEvent).dataTransfer?.files || []);
        if (droppedFiles.length > 0) {
          state.files = droppedFiles;
          renderSelection();
        }
      }
      setDragging(false);
    });
  }

  renderSelection();
  renderRunState();

  function setDragging(isDragging: boolean): void {
    state.isDragging = isDragging;
    dropzone.classList.toggle("is-dragging", isDragging);
  }

  function renderSelection(): void {
    if (state.files.length === 0) {
      selectionLabel.textContent = state.configFile
        ? `No SVG input selected. Config: ${state.configFile.name}`
        : "Nothing selected.";
      return;
    }

    const names = state.files.map((file) => getImportLabel(file)).slice(0, 4);
    const suffix = state.files.length > 4 ? ` +${state.files.length - 4} more` : "";
    const configSuffix = state.configFile ? ` | Config: ${state.configFile.name}` : "";
    selectionLabel.textContent = `${names.join(", ")}${suffix}${configSuffix}`;
  }

  function renderRunState(): void {
    const currentRun = state.currentRun;
    if (!currentRun) {
      summaryList.innerHTML = "<li>No import has been run yet.</li>";
      warningList.innerHTML = "<li>No warnings.</li>";
      viewerMeta.textContent = "No output generated yet.";
      viewerBody.innerHTML = `<div class="empty-state">Pick files, choose an output format, then generate a client-side bundle.</div>`;
      outputFileSelect.innerHTML = "";
      downloadButton.classList.add("is-disabled");
      downloadButton.disabled = true;
      return;
    }

    summaryList.innerHTML = currentRun.artboardSummary
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    warningList.innerHTML =
      currentRun.importWarnings.length === 0 && currentRun.renderWarnings.length === 0
        ? "<li>No warnings.</li>"
        : [
            ...currentRun.importWarnings.map((warning) => `Import: ${warning}`),
            ...currentRun.renderWarnings.map((warning) => `Render: ${warning}`),
          ]
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("");

    outputFileSelect.innerHTML = currentRun.fileSummary
      .map((path) => `<option value="${escapeHtml(path)}">${escapeHtml(path)}</option>`)
      .join("");
    if (!currentRun.fileSummary.includes(outputFileSelect.value)) {
      outputFileSelect.value = currentRun.emittedPath;
    }

    viewerMeta.textContent = `${currentRun.slug} · ${getOutputFormatLabel(currentRun.format)} · ${currentRun.fileSummary.length} file(s)`;
    const selectedPath = outputFileSelect.value || currentRun.emittedPath;
    const selectedFile = getBundleFile(currentRun.bundle, selectedPath);
    if (!selectedFile?.text) {
      viewerBody.innerHTML = `<div class="empty-state">No preview available for ${escapeHtml(selectedPath)}.</div>`;
    } else if (currentRun.format === "html" || currentRun.format === "standalone") {
      viewerBody.innerHTML = `<iframe class="preview-frame" title="all2html preview" sandbox="allow-scripts"></iframe>`;
      const frame = viewerBody.querySelector<HTMLIFrameElement>("iframe")!;
      frame.srcdoc = selectedFile.text;
    } else {
      viewerBody.innerHTML = `<pre class="code-view"></pre>`;
      viewerBody.querySelector<HTMLElement>("pre")!.textContent = selectedFile.text;
    }

    downloadButton.classList.remove("is-disabled");
    downloadButton.disabled = false;
  }

  function renderErrorState(message: string): void {
    state.currentRun = null;
    renderRunState();
    summaryList.innerHTML = "<li>Generation failed.</li>";
    warningList.innerHTML = `<li>${escapeHtml(message)}</li>`;
    viewerMeta.textContent = "Generation failed.";
    viewerBody.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  async function generate(): Promise<void> {
    if (state.files.length === 0) {
      warningList.innerHTML = "<li>Select SVG files or a ZIP before generating.</li>";
      return;
    }

    try {
      const parsedConfig = state.configFile
        ? deps.parseConfig(await state.configFile.text(), state.configFile.name)
        : undefined;
      const rasterizer = await deps.createRasterizer();
      const loaded = await deps.loadFiles(state.files);
      const format = formatSelect.value as SupportedFormat;
      const slug = slugInput.value.trim() || loaded.slug;

      const conversion = await deps.convert({
        loaded,
        slug,
        format,
        formatLabel: getOutputFormatLabel(format),
        parsedConfig,
        rasterizer,
        importFiles: deps.importFiles,
        process: deps.process,
        emitter: deps.emitter,
        buildBundle: deps.buildBundle,
      });

      state.currentRun = toRunState(conversion);
      renderRunState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      renderErrorState(message);
    }
  }
}

function toRunState(conversion: BrowserSvgConversionResult): RunState {
  return {
    loaded: conversion.loaded,
    bundle: conversion.bundle,
    emittedPath: conversion.emittedPath,
    format: conversion.format as SupportedFormat,
    slug: conversion.slug,
    importWarnings: conversion.importWarnings,
    renderWarnings: conversion.renderWarnings,
    artboardSummary: [
      `${conversion.artboardCount} artboard(s) imported`,
      `${conversion.groupCount} responsive group(s)`,
      `Assets: ${conversion.assetCount}`,
    ],
    fileSummary: conversion.filePaths,
  };
}

export function getImportLabel(file: File): string {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relativePath && relativePath.length > 0 ? relativePath : file.name;
}

export function getOutputFormatLabel(format: SupportedFormat): string {
  switch (format) {
    case "html":
      return "HTML fragment";
    case "standalone":
      return "Standalone HTML";
    case "svelte":
      return "Svelte";
    case "react":
      return "React";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : bytes.slice().buffer;
}
