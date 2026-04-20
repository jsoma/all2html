import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { loadSVGImportFilesFromBrowser } from "../../src/importers/svg/browser.js";

describe("browser SVG loader", () => {
  it("loads a single svg file", async () => {
    const file = makeBrowserFile(
      "story.svg",
      '<svg width="100" height="50" xmlns="http://www.w3.org/2000/svg"><text x="10" y="20">Hi</text></svg>',
      "image/svg+xml",
    );

    const loaded = await loadSVGImportFilesFromBrowser([file]);
    expect(loaded.slug).toBe("story");
    expect(loaded.entrypointPaths).toEqual(["story.svg"]);
  });

  it("loads a zip archive of svg files", async () => {
    const zip = zipSync({
      "story--640.svg": new TextEncoder().encode(
        '<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg"><text x="10" y="20">One</text></svg>',
      ),
      "story--960.svg": new TextEncoder().encode(
        '<svg width="960" height="540" xmlns="http://www.w3.org/2000/svg"><text x="10" y="20">Two</text></svg>',
      ),
    });
    const file = makeBrowserBinaryFile("story.zip", zip, "application/zip");

    const loaded = await loadSVGImportFilesFromBrowser([file]);
    expect(loaded.slug).toBe("story");
    expect(loaded.entrypointPaths).toEqual(["story--640.svg", "story--960.svg"]);
  });

  it("preserves webkitdirectory relative paths when loading folders", async () => {
    const file = makeBrowserFile(
      "card.svg",
      '<svg width="100" height="50" xmlns="http://www.w3.org/2000/svg"><text x="10" y="20">Hi</text></svg>',
      "image/svg+xml",
      "canva-export/card.svg",
    );

    const loaded = await loadSVGImportFilesFromBrowser([file]);
    expect(loaded.slug).toBe("canva-export");
    expect(loaded.entrypointPaths).toEqual(["canva-export/card.svg"]);
  });
});

function makeBrowserFile(
  name: string,
  text: string,
  type: string,
  webkitRelativePath?: string,
): File {
  return {
    name,
    type,
    webkitRelativePath,
    async text() {
      return text;
    },
    async arrayBuffer() {
      return new TextEncoder().encode(text).buffer;
    },
  } as unknown as File;
}

function makeBrowserBinaryFile(
  name: string,
  bytes: Uint8Array,
  type: string,
  webkitRelativePath?: string,
): File {
  return {
    name,
    type,
    webkitRelativePath,
    async text() {
      return new TextDecoder().decode(bytes);
    },
    async arrayBuffer() {
      return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.slice().buffer;
    },
  } as unknown as File;
}
