import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  loadSVGImportFilesFromArchive,
  MAX_SVG_ARCHIVE_ENTRIES,
  MAX_SVG_ARCHIVE_EXPANDED_BYTES,
} from "../../src/importers/svg/archive.js";
import { loadSVGImportFilesFromBrowser } from "../../src/importers/svg/browser.js";
import { loadSVGImportFiles } from "../../src/importers/svg/node.js";

const SVG_TEXT = '<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg"></svg>';

function makeArchive(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries);
}

function svgBytes(): Uint8Array {
  return new TextEncoder().encode(SVG_TEXT);
}

describe("shared SVG archive loader", () => {
  it("pins the production limits", () => {
    expect(MAX_SVG_ARCHIVE_ENTRIES).toBe(2000);
    expect(MAX_SVG_ARCHIVE_EXPANDED_BYTES).toBe(256 * 1024 * 1024);
  });

  it("rejects an archive with more entries than the default limit", () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < MAX_SVG_ARCHIVE_ENTRIES + 1; i += 1) {
      entries[`file-${i}.svg`] = new Uint8Array(0);
    }
    expect(() => loadSVGImportFilesFromArchive(makeArchive(entries), { slug: "big" })).toThrow(
      /at most 2000 files per archive/,
    );
  });

  it("rejects an archive whose declared expanded size passes the limit", () => {
    // One MiB override keeps the test light; the check reads fflate's declared
    // `originalSize` metadata, so the enforcement path is identical to the
    // 256 MiB production cap.
    const archive = makeArchive({
      "a.svg": new Uint8Array(700 * 1024),
      "b.svg": new Uint8Array(700 * 1024),
    });
    expect(() =>
      loadSVGImportFilesFromArchive(archive, {
        slug: "bomb",
        limits: { maxExpandedBytes: 1024 * 1024 },
      }),
    ).toThrow(/expand past the 1 MiB limit/);
  });

  it("checks the caps against metadata, not decompressed bytes", () => {
    // 700 KiB of zeros deflates to a few hundred bytes, so a compressed-size
    // check would pass: only the declared expanded size trips the cap.
    const archive = makeArchive({ "a.svg": new Uint8Array(700 * 1024) });
    expect(archive.byteLength).toBeLessThan(64 * 1024);
    expect(() =>
      loadSVGImportFilesFromArchive(archive, {
        slug: "bomb",
        limits: { maxExpandedBytes: 512 * 1024 },
      }),
    ).toThrow(/512 KiB|expand past/);
  });

  it("does not count skipped entries (directories, __MACOSX) against the entry cap", () => {
    const archive = makeArchive({
      "story.svg": svgBytes(),
      "images/photo.png": Uint8Array.from([1, 2, 3]),
      "__MACOSX/._story.svg": Uint8Array.from([0]),
    });
    const loaded = loadSVGImportFilesFromArchive(archive, {
      slug: "story",
      limits: { maxEntries: 2 },
    });
    expect(loaded.files.map((file) => file.path)).toEqual(["images/photo.png", "story.svg"]);
  });

  it("rejects an archive with zero SVG entries", () => {
    const archive = makeArchive({ "images/photo.png": Uint8Array.from([1, 2, 3]) });
    expect(() => loadSVGImportFilesFromArchive(archive, { slug: "no-svg" })).toThrow(
      /contains no \.svg entries/,
    );
  });

  it("keeps entry decisions identical between the Node and browser loaders", async () => {
    const archive = makeArchive({
      "story--640.svg": svgBytes(),
      "story--960.svg": svgBytes(),
      "images/photo.png": Uint8Array.from([1, 2, 3]),
      "__MACOSX/._story--640.svg": Uint8Array.from([0]),
    });

    const root = mkdtempSync(join(tmpdir(), "all2html-archive-parity-"));
    try {
      const zipPath = join(root, "story.zip");
      writeFileSync(zipPath, archive);
      const fromNode = loadSVGImportFiles(zipPath);
      const fromBrowser = await loadSVGImportFilesFromBrowser([
        makeBrowserZipFile("story.zip", archive),
      ]);

      expect(fromNode.slug).toBe("story");
      expect(fromBrowser.slug).toBe("story");
      expect(fromNode.entrypointPaths).toEqual(fromBrowser.entrypointPaths);
      expect(fromNode.files.map((file) => file.path)).toEqual(
        fromBrowser.files.map((file) => file.path),
      );
      // Same retention and decode decisions: SVGs become strings, everything
      // else stays bytes, on both surfaces.
      for (const [index, nodeFile] of fromNode.files.entries()) {
        const browserFile = fromBrowser.files[index];
        expect(typeof nodeFile.content).toBe(typeof browserFile.content);
        if (typeof nodeFile.content === "string") {
          expect(nodeFile.content).toBe(browserFile.content);
        } else {
          expect(Array.from(nodeFile.content)).toEqual(
            Array.from(browserFile.content as Uint8Array),
          );
        }
      }
      // MIME inference is the one declared surface difference: the browser
      // loader infers types, the Node loader leaves them unset.
      expect(fromBrowser.files.map((file) => file.mimeType)).toEqual([
        "image/png",
        "image/svg+xml",
        "image/svg+xml",
      ]);
      expect(fromNode.files.every((file) => file.mimeType === undefined)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects the same over-cap archive on both loaders", async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < MAX_SVG_ARCHIVE_ENTRIES + 1; i += 1) {
      entries[`file-${i}.svg`] = new Uint8Array(0);
    }
    const archive = makeArchive(entries);

    const root = mkdtempSync(join(tmpdir(), "all2html-archive-cap-"));
    try {
      const zipPath = join(root, "big.zip");
      writeFileSync(zipPath, archive);
      expect(() => loadSVGImportFiles(zipPath)).toThrow(/at most 2000 files/);
      await expect(
        loadSVGImportFilesFromBrowser([makeBrowserZipFile("big.zip", archive)]),
      ).rejects.toThrow(/at most 2000 files/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function makeBrowserZipFile(name: string, bytes: Uint8Array): File {
  return {
    name,
    type: "application/zip",
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
