// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { mountSvgDropzoneApp } from "../../apps/svg-dropzone/src/app.js";

function assignFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
}

describe("svg dropzone app", () => {
  it("tracks drag/drop file selection", async () => {
    const root = document.createElement("div");
    document.body.append(root);

    mountSvgDropzoneApp(root, {
      async createRasterizer() {
        throw new Error("not used");
      },
      async loadFiles() {
        throw new Error("not used");
      },
      parseConfig: vi.fn() as any,
      importFiles: vi.fn() as any,
      process: vi.fn() as any,
      emitter: vi.fn() as any,
      buildBundle: vi.fn() as any,
      zipBundle: vi.fn() as any,
      download: vi.fn(),
    });

    const dropzone = root.querySelector<HTMLElement>("[data-dropzone]")!;
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
        return {
          slug: "story",
          entrypointPaths: ["story.svg"],
          files: [{ path: "story.svg", content: "<svg />", mimeType: "image/svg+xml" }],
        };
      },
      parseConfig() {
        return { emit: { react: { typescript: true } } };
      },
      async importFiles() {
        return {
          document: {
            irVersion: "0.0.0",
            generator: { tool: "svg", toolVersion: "1.0", pluginVersion: "0.1.0" },
            settings: {
              projectName: "story",
              output: "one-file",
              imageSourcePath: "",
              imageOutputPath: "",
              htmlOutputPath: "",
            },
            fonts: [],
            artboards: [
              {
                name: "story",
                originalName: "story.svg",
                width: 320,
                height: 180,
                actualWidth: 320,
                actualHeight: 180,
                layers: [],
              },
            ],
            customBlocks: [],
            assets: {},
            metadata: { slug: "story" },
          },
          assetFiles: [
            { path: "story.png", bytes: Uint8Array.from([1, 2, 3]), mimeType: "image/png" },
          ],
          warnings: ["import warning"],
        };
      },
      process() {
        return {
          document: {
            settings: {
              projectName: "story",
              imageOutputPath: "",
            },
            metadata: { slug: "story" },
            artboards: [{ name: "story" }, { name: "story-2" }],
          } as any,
          groups: [{ slug: "story", artboards: [] }] as any,
          warnings: ["render warning"],
        };
      },
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
            };
          },
        };
      },
      buildBundle(options) {
        return {
          files: [
            {
              path: "ir.json",
              bytes: new TextEncoder().encode("{}"),
              mimeType: "application/json",
              text: "{}",
            },
            {
              path: `${options.emittedFiles[0].slug}${options.emittedFiles[0].extension}`,
              bytes: new TextEncoder().encode(options.emittedFiles[0].output),
              mimeType: "text/html",
              text: options.emittedFiles[0].output,
            },
          ],
        };
      },
      zipBundle() {
        return new Uint8Array([1, 2, 3]);
      },
      download,
    });

    const fileInput = root.querySelector<HTMLInputElement>("[data-file-input]")!;
    assignFiles(fileInput, [new File(["<svg />"], "story.svg", { type: "image/svg+xml" })]);
    fileInput.dispatchEvent(new Event("change"));

    const configInput = root.querySelector<HTMLInputElement>("[data-config-input]")!;
    assignFiles(configInput, [
      new File(['{"emit":{"react":{"typescript":true}}}'], "config.json", {
        type: "application/json",
      }),
    ]);
    configInput.dispatchEvent(new Event("change"));

    root.querySelector<HTMLButtonElement>("[data-generate]")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector("[data-summary]")?.textContent).toContain("2 artboard(s) imported");
    expect(root.querySelector("[data-warnings]")?.textContent).toContain("Import: import warning");
    expect(root.querySelector<HTMLIFrameElement>("iframe")?.srcdoc).toContain("preview");

    root.querySelector<HTMLButtonElement>("[data-download]")!.click();
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
        return {
          slug: "story",
          entrypointPaths: ["story.svg"],
          files: [{ path: "story.svg", content: "<svg />" }],
        };
      },
      parseConfig: (text, source) => ({ emit: {}, settings: {}, fonts: [] }) as any,
      async importFiles() {
        return {
          document: {
            irVersion: "0.0.0",
            generator: { tool: "svg", toolVersion: "1.0", pluginVersion: "0.1.0" },
            settings: {
              projectName: "story",
              output: "one-file",
              imageSourcePath: "",
              imageOutputPath: "",
              htmlOutputPath: "",
            },
            fonts: [],
            artboards: [],
            customBlocks: [],
            assets: {},
            metadata: { slug: "story" },
          },
          assetFiles: [],
          warnings: [],
        };
      },
      process() {
        return {
          document: {
            settings: {
              projectName: "story",
              imageOutputPath: "",
            },
            metadata: { slug: "story" },
            artboards: [],
          } as any,
          groups: [{ slug: "story", artboards: [] }] as any,
          warnings: [],
        };
      },
      emitter(format) {
        return {
          name: format,
          emitAll() {
            return {
              files: [
                { slug: "story", extension: ".jsx", output: "export default function Story() {}" },
              ],
              warnings: [],
            };
          },
        };
      },
      buildBundle(options) {
        return {
          files: [
            {
              path: "ir.json",
              bytes: new TextEncoder().encode("{}"),
              mimeType: "application/json",
              text: "{}",
            },
            {
              path: "story.jsx",
              bytes: new TextEncoder().encode(options.emittedFiles[0].output),
              mimeType: "text/plain",
              text: options.emittedFiles[0].output,
            },
          ],
        };
      },
      zipBundle: () => new Uint8Array([1]),
      download: vi.fn(),
    });

    const formatSelect = root.querySelector<HTMLSelectElement>("[data-format]")!;
    formatSelect.value = "react";
    const fileInput = root.querySelector<HTMLInputElement>("[data-file-input]")!;
    assignFiles(fileInput, [new File(["<svg />"], "story.svg", { type: "image/svg+xml" })]);
    fileInput.dispatchEvent(new Event("change"));
    root.querySelector<HTMLButtonElement>("[data-generate]")!.click();
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
        return {
          slug: "story",
          entrypointPaths: ["story.svg"],
          files: [{ path: "story.svg", content: "<svg />", mimeType: "image/svg+xml" }],
        };
      },
      parseConfig,
      async importFiles() {
        return {
          document: {
            irVersion: "0.0.0",
            generator: { tool: "svg", toolVersion: "1.0", pluginVersion: "0.1.0" },
            settings: {
              projectName: "story",
              output: "one-file",
              imageSourcePath: "",
              imageOutputPath: "",
              htmlOutputPath: "",
            },
            fonts: [],
            artboards: [],
            customBlocks: [],
            assets: {},
            metadata: { slug: "story" },
          },
          assetFiles: [],
          warnings: [],
        };
      },
      process() {
        return {
          document: {
            settings: {
              projectName: "story",
              imageOutputPath: "",
            },
            metadata: { slug: "story" },
            artboards: [],
          } as any,
          groups: [{ slug: "story", artboards: [] }] as any,
          warnings: [],
        };
      },
      emitter() {
        return {
          name: "html",
          emitAll() {
            return {
              files: [{ slug: "story", extension: ".html", output: "<div>preview</div>" }],
              warnings: [],
            };
          },
        };
      },
      buildBundle(options) {
        return {
          files: [
            {
              path: "ir.json",
              bytes: new TextEncoder().encode("{}"),
              mimeType: "application/json",
              text: "{}",
            },
            {
              path: `${options.emittedFiles[0].slug}${options.emittedFiles[0].extension}`,
              bytes: new TextEncoder().encode(options.emittedFiles[0].output),
              mimeType: "text/html",
              text: options.emittedFiles[0].output,
            },
          ],
        };
      },
      zipBundle: () => new Uint8Array([1]),
      download: vi.fn(),
    });

    const fileInput = root.querySelector<HTMLInputElement>("[data-file-input]")!;
    assignFiles(fileInput, [new File(["<svg />"], "story.svg", { type: "image/svg+xml" })]);
    fileInput.dispatchEvent(new Event("change"));

    const configInput = root.querySelector<HTMLInputElement>("[data-config-input]")!;
    assignFiles(configInput, [
      new File(['{"emit":{}}'], "config.json", { type: "application/json" }),
    ]);
    configInput.dispatchEvent(new Event("change"));

    root.querySelector<HTMLButtonElement>("[data-generate]")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector<HTMLIFrameElement>("iframe")?.srcdoc).toContain("preview");

    root.querySelector<HTMLButtonElement>("[data-generate]")!.click();
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
        return {
          slug: "story",
          entrypointPaths: ["story.svg"],
          files: [{ path: "story.svg", content: "<svg />", mimeType: "image/svg+xml" }],
        };
      },
      parseConfig: () => ({ emit: {}, settings: {}, fonts: [] }) as any,
      async importFiles() {
        return {
          document: {
            irVersion: "0.0.0",
            generator: { tool: "svg", toolVersion: "1.0", pluginVersion: "0.1.0" },
            settings: {
              projectName: "story",
              output: "one-file",
              imageSourcePath: "",
              imageOutputPath: "",
              htmlOutputPath: "",
            },
            fonts: [],
            artboards: [],
            customBlocks: [],
            assets: {},
            metadata: { slug: "story" },
          },
          assetFiles: [],
          warnings: [],
        };
      },
      process() {
        return {
          document: {
            settings: {
              projectName: "story",
              imageOutputPath: "",
            },
            metadata: { slug: "story" },
            artboards: [],
          } as any,
          groups: [{ slug: "story", artboards: [] }] as any,
          warnings: [],
        };
      },
      emitter() {
        return {
          name: "html",
          emitAll() {
            return {
              files: [],
              warnings: [],
            };
          },
        };
      },
      buildBundle: vi.fn() as any,
      zipBundle: () => new Uint8Array([1]),
      download: vi.fn(),
    });

    const fileInput = root.querySelector<HTMLInputElement>("[data-file-input]")!;
    assignFiles(fileInput, [new File(["<svg />"], "story.svg", { type: "image/svg+xml" })]);
    fileInput.dispatchEvent(new Event("change"));

    root.querySelector<HTMLButtonElement>("[data-generate]")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector("[data-warnings]")?.textContent).toContain(
      "No HTML fragment files were emitted.",
    );
    expect(root.querySelector("iframe")).toBeNull();

    document.body.innerHTML = "";
  });
});
