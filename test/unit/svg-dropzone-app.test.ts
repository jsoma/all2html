// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { mountSvgDropzoneApp } from "../../apps/svg-dropzone/src/app.js";
import {
  convertLoadedSvgFilesInBrowser,
  getBrowserEmitter,
  processDocumentInBrowser,
} from "../../src/browser.js";
import { processDocument } from "../../src/core/pipeline.js";
import { CURRENT_IR_VERSION, type Document } from "../../src/ir/types.js";
import { createOutputBundle } from "../../src/output-bundle.js";

type SvgDropzoneDependencies = Required<NonNullable<Parameters<typeof mountSvgDropzoneApp>[1]>>;
type LoadedFiles = Awaited<ReturnType<SvgDropzoneDependencies["loadFiles"]>>;
type ParseConfigResult = ReturnType<SvgDropzoneDependencies["parseConfig"]>;
type ImportFilesResult = Awaited<ReturnType<SvgDropzoneDependencies["importFiles"]>>;
type BuildBundleOptions = Parameters<SvgDropzoneDependencies["buildBundle"]>[0];

function assignFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

function emptyConfig(): ParseConfigResult {
  return { emit: {}, settings: {}, fonts: [] };
}

function createLoadedFiles(): LoadedFiles {
  return {
    slug: "story",
    entrypointPaths: ["story.svg"],
    files: [{ path: "story.svg", content: "<svg />", mimeType: "image/svg+xml" }],
  };
}

function createDocument(artboardNames: string[] = ["story"]): Document {
  return {
    irVersion: CURRENT_IR_VERSION,
    source: { tool: "svg", toolVersion: "1.0", adapterVersion: "0.1.0" },
    settings: {
      projectName: "story",
      output: "one-file",
      imageSourcePath: "",
      imageOutputPath: "",
      htmlOutputPath: "",
    },
    fonts: [],
    // Widths increase per artboard because `computeBreakpoints` refuses two
    // artboards of the same width on one page — it has no way to say which is
    // the narrow variant. A single-artboard document is still 320 wide, which is
    // what every other test here reads.
    artboards: artboardNames.map((name, index) => {
      const width = 320 * (index + 1);
      return {
        id: `artboard:${name}`,
        name,
        width,
        height: 180,
        source: { tool: "svg", id: `${name}.svg`, name: `${name}.svg`, width, height: 180 },
        layers: [],
      };
    }),
    customBlocks: [],
    assets: {},
    metadata: { slug: "story" },
  };
}

function createImportResult({
  artboardNames = ["story"],
  assetFiles = [],
  warnings = [],
}: {
  artboardNames?: string[];
  assetFiles?: ImportFilesResult["assetFiles"];
  warnings?: string[];
} = {}): ImportFilesResult {
  return {
    document: createDocument(artboardNames),
    assetFiles,
    warnings,
    structuredWarnings: [],
  };
}

function createPreviewBundle(options: BuildBundleOptions) {
  const emittedFile = options.emittedFiles[0];
  if (!emittedFile) {
    throw new Error("Missing emitted file");
  }
  return createOutputBundle(options);
}

function createUnusedDependencies(): SvgDropzoneDependencies {
  return {
    async createRasterizer() {
      throw new Error("not used");
    },
    async loadFiles() {
      throw new Error("not used");
    },
    parseConfig: emptyConfig,
    async importFiles() {
      throw new Error("not used");
    },
    process: processDocument,
    emitter() {
      throw new Error("not used");
    },
    buildBundle() {
      return createOutputBundle({ irDocument: createDocument(), emittedFiles: [], assetFiles: [] });
    },
    convert: convertLoadedSvgFilesInBrowser,
    zipBundle() {
      return new Uint8Array();
    },
    download: vi.fn(),
  };
}

describe("svg dropzone app", () => {
  it("tracks drag/drop file selection", async () => {
    const root = document.createElement("div");
    document.body.append(root);

    mountSvgDropzoneApp(root, createUnusedDependencies());

    const dropzone = requireElement<HTMLElement>(root, "[data-dropzone]");
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "dataTransfer", {
      configurable: true,
      value: {
        files: [new File(["<svg />"], "story.svg", { type: "image/svg+xml" })],
      },
    });
    dropzone.dispatchEvent(dropEvent);

    expect(root.querySelector("[data-selection]")?.textContent).toContain("story.svg");
    document.body.innerHTML = "";
  });

  it("renders html preview with a downloadable bundle", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const download = vi.fn();

    mountSvgDropzoneApp(root, {
      async createRasterizer() {
        return {
          async rasterizeSvg() {
            return {
              width: 2,
              height: 1,
              pixels: Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255]),
            };
          },
        };
      },
      async loadFiles(files) {
        expect(Array.from(files)).toHaveLength(1);
        return createLoadedFiles();
      },
      parseConfig() {
        return { emit: { react: { typescript: true } } };
      },
      async importFiles() {
        return createImportResult({
          artboardNames: ["story", "story-2"],
          assetFiles: [
            { path: "story.png", bytes: Uint8Array.from([1, 2, 3]), mimeType: "image/png" },
          ],
          warnings: ["import warning"],
        });
      },
      process: processDocument,
      emitter(format) {
        return {
          name: format,
          emitAll() {
            return {
              files: [
                {
                  slug: "story",
                  extension: format === "react" ? ".jsx" : ".html",
                  output:
                    format === "react"
                      ? "export default function Story() {}"
                      : "<div>preview</div>",
                },
              ],
              warnings: [],
              structuredWarnings: [],
            };
          },
        };
      },
      buildBundle(options) {
        return createPreviewBundle(options);
      },
      zipBundle() {
        return new Uint8Array([1, 2, 3]);
      },
      download,
    });

    const fileInput = requireElement<HTMLInputElement>(root, "[data-file-input]");
    assignFiles(fileInput, [new File(["<svg />"], "story.svg", { type: "image/svg+xml" })]);
    fileInput.dispatchEvent(new Event("change"));

    const configInput = requireElement<HTMLInputElement>(root, "[data-config-input]");
    assignFiles(configInput, [
      new File(['{"emit":{"react":{"typescript":true}}}'], "config.json", {
        type: "application/json",
      }),
    ]);
    configInput.dispatchEvent(new Event("change"));

    requireElement<HTMLButtonElement>(root, "[data-generate]").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector("[data-summary]")?.textContent).toContain("2 artboard(s) imported");
    expect(root.querySelector("[data-warnings]")?.textContent).toContain("Import: import warning");
    expect(root.querySelector<HTMLIFrameElement>("iframe")?.srcdoc).toContain("preview");

    requireElement<HTMLButtonElement>(root, "[data-download]").click();
    expect(download).toHaveBeenCalled();
    document.body.innerHTML = "";
  });

  it("shows code output for react format", async () => {
    const root = document.createElement("div");
    document.body.append(root);

    mountSvgDropzoneApp(root, {
      async createRasterizer() {
        return {
          async rasterizeSvg() {
            return {
              width: 1,
              height: 1,
              pixels: Uint8Array.from([255, 255, 255, 255]),
            };
          },
        };
      },
      async loadFiles() {
        return createLoadedFiles();
      },
      parseConfig: emptyConfig,
      async importFiles() {
        return createImportResult();
      },
      process: processDocument,
      emitter(format) {
        return {
          name: format,
          emitAll() {
            return {
              files: [
                { slug: "story", extension: ".jsx", output: "export default function Story() {}" },
              ],
              warnings: [],
              structuredWarnings: [],
            };
          },
        };
      },
      buildBundle(options) {
        return createPreviewBundle(options);
      },
      zipBundle: () => new Uint8Array([1]),
      download: vi.fn(),
    });

    const formatSelect = requireElement<HTMLSelectElement>(root, "[data-format]");
    formatSelect.value = "react";
    const fileInput = requireElement<HTMLInputElement>(root, "[data-file-input]");
    assignFiles(fileInput, [new File(["<svg />"], "story.svg", { type: "image/svg+xml" })]);
    fileInput.dispatchEvent(new Event("change"));
    requireElement<HTMLButtonElement>(root, "[data-generate]").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector(".code-view")?.textContent).toContain(
      "export default function Story",
    );
    document.body.innerHTML = "";
  });

  it("clears stale output and shows an error when a later generate fails", async () => {
    const root = document.createElement("div");
    document.body.append(root);

    const parseConfig = vi
      .fn()
      .mockReturnValueOnce({ emit: {}, settings: {}, fonts: [] })
      .mockImplementationOnce(() => {
        throw new Error("Bad config");
      });

    mountSvgDropzoneApp(root, {
      async createRasterizer() {
        return {
          async rasterizeSvg() {
            return {
              width: 1,
              height: 1,
              pixels: Uint8Array.from([255, 255, 255, 255]),
            };
          },
        };
      },
      async loadFiles() {
        return createLoadedFiles();
      },
      parseConfig,
      async importFiles() {
        return createImportResult();
      },
      process: processDocument,
      emitter() {
        return {
          name: "html",
          emitAll() {
            return {
              files: [{ slug: "story", extension: ".html", output: "<div>preview</div>" }],
              warnings: [],
              structuredWarnings: [],
            };
          },
        };
      },
      buildBundle(options) {
        return createPreviewBundle(options);
      },
      zipBundle: () => new Uint8Array([1]),
      download: vi.fn(),
    });

    const fileInput = requireElement<HTMLInputElement>(root, "[data-file-input]");
    assignFiles(fileInput, [new File(["<svg />"], "story.svg", { type: "image/svg+xml" })]);
    fileInput.dispatchEvent(new Event("change"));

    const configInput = requireElement<HTMLInputElement>(root, "[data-config-input]");
    assignFiles(configInput, [
      new File(['{"emit":{}}'], "config.json", { type: "application/json" }),
    ]);
    configInput.dispatchEvent(new Event("change"));

    requireElement<HTMLButtonElement>(root, "[data-generate]").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector<HTMLIFrameElement>("iframe")?.srcdoc).toContain("preview");

    requireElement<HTMLButtonElement>(root, "[data-generate]").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector("[data-summary]")?.textContent).toContain("Generation failed.");
    expect(root.querySelector("[data-warnings]")?.textContent).toContain("Bad config");
    expect(root.querySelector("iframe")).toBeNull();
    expect(root.querySelector("[data-viewer-body]")?.textContent).toContain("Bad config");

    document.body.innerHTML = "";
  });

  it("surfaces an explicit error when an emitter returns no files", async () => {
    const root = document.createElement("div");
    document.body.append(root);

    mountSvgDropzoneApp(root, {
      async createRasterizer() {
        return {
          async rasterizeSvg() {
            return {
              width: 1,
              height: 1,
              pixels: Uint8Array.from([255, 255, 255, 255]),
            };
          },
        };
      },
      async loadFiles() {
        return createLoadedFiles();
      },
      parseConfig: emptyConfig,
      async importFiles() {
        return createImportResult();
      },
      process: processDocument,
      emitter() {
        return {
          name: "html",
          emitAll() {
            return {
              files: [],
              warnings: [],
              structuredWarnings: [],
            };
          },
        };
      },
      buildBundle() {
        return createOutputBundle({
          irDocument: createDocument(),
          emittedFiles: [],
          assetFiles: [],
        });
      },
      zipBundle: () => new Uint8Array([1]),
      download: vi.fn(),
    });

    const fileInput = requireElement<HTMLInputElement>(root, "[data-file-input]");
    assignFiles(fileInput, [new File(["<svg />"], "story.svg", { type: "image/svg+xml" })]);
    fileInput.dispatchEvent(new Event("change"));

    requireElement<HTMLButtonElement>(root, "[data-generate]").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector("[data-warnings]")?.textContent).toContain(
      "No HTML fragment files were emitted.",
    );
    expect(root.querySelector("iframe")).toBeNull();

    document.body.innerHTML = "";
  });
});

describe("browser pipeline surface", () => {
  /**
   * `processDocumentInBrowser` used to build its default surface context
   * without a format, so format-qualified declarations
   * (`unsupportedFormats: ["standalone"]`) could never fire for direct callers.
   */
  it("threads the target format into the default surface context", () => {
    // `htmlOutputExtension` is the probe because it is format-scoped: only the
    // html emitter reads it, and standalone hardcodes `.html`. (`output` used to
    // be the probe, back when the standalone emitter discarded artboard groups.)
    const doc = createDocument();
    doc.settings = { ...doc.settings, htmlOutputExtension: ".php" };

    const asHtml = processDocumentInBrowser(structuredClone(doc), { format: "html" });
    const asStandalone = processDocumentInBrowser(structuredClone(doc), { format: "standalone" });

    const forSetting = (result: { structuredWarnings: { setting?: string }[] }) =>
      result.structuredWarnings.some((warning) => warning.setting === "htmlOutputExtension");
    expect(forSetting(asHtml)).toBe(false);
    expect(forSetting(asStandalone)).toBe(true);
  });

  it("still defaults to the browser converter, whose declaration differs from the CLI's", () => {
    const doc = createDocument();
    // D30: the browser standalone emitter discards localPreviewTemplate; the
    // Node CLI applies it. Getting this warning proves the default context is
    // `browser`, not `cli`.
    doc.settings = { ...doc.settings, localPreviewTemplate: "preview.html" };

    const result = processDocumentInBrowser(doc, { format: "html" });
    const warning = result.structuredWarnings.find(
      (entry) => entry.setting === "localPreviewTemplate",
    );
    expect(warning?.surface).toBe("browser");
  });

  /**
   * One owner for the warning: the capability checker.
   *
   * `standalone-browser.ts` used to raise its own `setting:unsupported` for
   * `localPreviewTemplate` on top of the checker's, once per output group, with
   * `surface: "browser"` hardcoded — so a three-group document produced four
   * copies, and a Figma export (which shares this emitter) was told the surface
   * was the browser. The checker already knows the setting and the real surface,
   * and it runs once per document.
   */
  it("warns exactly once for localPreviewTemplate, whatever the group count", () => {
    const doc = createDocument(["chart", "map", "table"]);
    doc.settings = {
      ...doc.settings,
      output: "multiple-files",
      localPreviewTemplate: "preview.html",
    };

    for (const surface of ["browser", "figma"] as const) {
      const processed = processDocumentInBrowser(structuredClone(doc), {
        format: "standalone",
        surface: { surface, path: "render", format: "standalone" },
      });
      expect(processed.groups.length).toBe(3);

      const emitted = getBrowserEmitter("standalone").emitAll(processed.document, processed.groups);
      expect(emitted.files).toHaveLength(3);

      const all = [...processed.structuredWarnings, ...emitted.structuredWarnings].filter(
        (entry) => entry.setting === "localPreviewTemplate",
      );
      expect(all, `${surface} raised ${all.length} warnings`).toHaveLength(1);
      expect(all[0].code).toBe("setting:unsupported");
      expect(all[0].surface).toBe(surface);
    }
  });

  /**
   * The app used to carry a local `escapeHtml` that escaped `"`, and used it in
   * both a text position and the `<option value="...">` attribute. It now
   * imports the shared pair, whose text escaper is deliberately narrowed to
   * hast's subset (`&` and `<` only) and does **not** escape `"` — so the
   * attribute site had to move to `escapeAttr` at the same time. This asserts
   * the split structurally rather than by inspecting the markup string: a value
   * that survives jsdom parsing byte-for-byte could not have closed its own
   * attribute.
   */
  it("escapes bundle paths per grammar: attribute value vs text content", async () => {
    const root = document.createElement("div");
    document.body.append(root);

    const hostilePath = `a" onmouseover="alert(1)" x="<img src=x onerror=alert(1)>.html`;
    const hostileWarning = `<img src=x onerror="alert(1)"> & <script>alert(1)</script>`;

    mountSvgDropzoneApp(root, {
      ...createUnusedDependencies(),
      async createRasterizer() {
        return {
          async rasterizeSvg() {
            throw new Error("not used");
          },
        };
      },
      async loadFiles() {
        return createLoadedFiles();
      },
      parseConfig: emptyConfig,
      async convert() {
        return {
          loaded: createLoadedFiles(),
          slug: "story",
          format: "html",
          irDocument: createDocument(),
          bundle: createOutputBundle({
            irDocument: createDocument(),
            emittedFiles: [{ slug: "story", extension: ".html", output: "<div>preview</div>" }],
            assetFiles: [],
          }),
          emittedPath: "story.html",
          importWarnings: [hostileWarning],
          renderWarnings: [],
          artboardCount: 1,
          groupCount: 1,
          assetCount: 0,
          filePaths: ["story.html", hostilePath],
        };
      },
    });

    const fileInput = requireElement<HTMLInputElement>(root, "[data-file-input]");
    assignFiles(fileInput, [new File(["<svg />"], "story.svg", { type: "image/svg+xml" })]);
    fileInput.dispatchEvent(new Event("change"));
    requireElement<HTMLButtonElement>(root, "[data-generate]").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const select = requireElement<HTMLSelectElement>(root, "[data-output-file]");
    const options = Array.from(select.options);
    expect(options).toHaveLength(2);
    // Round-trips exactly: the `"` never terminated the attribute, so no stray
    // `onmouseover` attribute and no injected element exist.
    expect(options[1].value).toBe(hostilePath);
    expect(options[1].textContent).toBe(hostilePath);
    expect(options[1].hasAttribute("onmouseover")).toBe(false);
    expect(select.querySelector("img")).toBeNull();

    const warningList = requireElement<HTMLElement>(root, "[data-warnings]");
    expect(warningList.textContent).toBe(`Import: ${hostileWarning}`);
    expect(warningList.querySelector("img")).toBeNull();
    expect(warningList.querySelector("script")).toBeNull();

    document.body.innerHTML = "";
  });
});
