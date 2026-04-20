import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { loadSVGImportFiles } from "../../src/importers/svg/node.js";

describe("loadSVGImportFiles", () => {
  it("loads a single SVG plus sibling support files without importing sibling SVGs", () => {
    const root = mkdtempSync(join(tmpdir(), "all2html-svg-load-"));
    try {
      writeFileSync(
        join(root, "story.svg"),
        '<svg width="100" height="50"><image href="images/photo.png"/></svg>',
      );
      writeFileSync(join(root, "other.svg"), '<svg width="10" height="10"></svg>');
      mkdirSync(join(root, "images"));
      writeFileSync(join(root, "images/photo.png"), Buffer.from([1, 2, 3]));

      const loaded = loadSVGImportFiles(join(root, "story.svg"));

      expect(loaded.slug).toBe("story");
      expect(loaded.entrypointPaths).toEqual(["story.svg"]);
      expect(loaded.files.some((file) => file.path === "other.svg")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads SVG entrypoints and support files from a zip archive", () => {
    const root = mkdtempSync(join(tmpdir(), "all2html-svg-zip-"));
    try {
      const archive = zipSync({
        "story--640.svg": new TextEncoder().encode('<svg width="640" height="360"></svg>'),
        "story--960.svg": new TextEncoder().encode('<svg width="960" height="540"></svg>'),
        "images/photo.png": Uint8Array.from([1, 2, 3]),
      });
      const zipPath = join(root, "bundle.zip");
      writeFileSync(zipPath, archive);

      const loaded = loadSVGImportFiles(zipPath);

      expect(loaded.slug).toBe("bundle");
      expect(loaded.entrypointPaths).toEqual(["story--640.svg", "story--960.svg"]);
      expect(loaded.files.some((file) => file.path === "images/photo.png")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
