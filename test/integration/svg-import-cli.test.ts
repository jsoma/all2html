import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/run.js";

const SIMPLE_SVG =
  '<svg width="320" height="180" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="180" fill="#ddd"/><text x="24" y="48" font-size="24">CLI import</text></svg>';

describe("all2html import svg CLI", () => {
  it("writes ir.json, emitted html, and extracted assets", () => {
    const root = mkdtempSync(join(tmpdir(), "all2html-svg-cli-"));
    const inputPath = join(root, "story.svg");
    const outputDir = join(root, "out");

    try {
      writeFileSync(inputPath, SIMPLE_SVG);

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli/index.ts",
          "import",
          "svg",
          inputPath,
          "-o",
          outputDir,
          "--format",
          "html",
        ],
        {
          cwd: resolve(import.meta.dirname, "../.."),
          encoding: "utf-8",
        },
      );

      expect(result.status).toBe(0);
      expect(readdirSync(outputDir).sort()).toEqual(
        expect.arrayContaining(["all2html-output", "ir.json", "story.html"]),
      );
      expect(existsSync(join(outputDir, "all2html-output", "story.png"))).toBe(true);
      expect(readFileSync(join(outputDir, "ir.json"), "utf-8")).toContain('"tool": "svg"');
      const html = readFileSync(join(outputDir, "story.html"), "utf-8");
      expect(html).toContain("CLI import");
      // Not two literals that happen to agree: every `src` the page emits is
      // resolved against the directory the page was written into, and the file
      // has to be there. `import` writes the emitted files at the root of `-o`
      // and the assets under `imageOutputPath`, so that directory is the path
      // from one to the other — which is exactly what the surface states as the
      // emitters' `assetBase`.
      const srcs = Array.from(html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)).map((match) => match[1]);
      expect(srcs).toEqual(["all2html-output/story.png"]);
      for (const src of srcs) {
        expect(existsSync(join(outputDir, src)), `${src} is referenced but not written`).toBe(true);
      }
      // The manifest slug is the *resolved* slug — the same value the emitted
      // file is named from, so the two cannot disagree. (The resolved-vs-
      // unresolved distinction itself is pinned in test/unit/output-bundle.test.ts
      // and the browser test in test/integration/surface-entrypoints.test.ts.)
      const manifest = JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf-8"));
      expect(manifest.slug).toBe("story");
      expect(manifest.files.map((file: { path: string }) => file.path)).toContain("story.html");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * All validation before the first write: `import` used to write the emitted
   * files *before* bundle construction, so a bundle-stage failure had already
   * replaced the prior output. Now a containment failure anywhere in the chain
   * means the output directory is never even created.
   */
  it("writes zero files when the bundle layout fails containment", async () => {
    const root = mkdtempSync(join(tmpdir(), "all2html-svg-cli-hostile-"));
    const inputPath = join(root, "story.svg");
    const configPath = join(root, "all2html.config.json");
    const outputDir = join(root, "out");

    try {
      writeFileSync(inputPath, SIMPLE_SVG);
      writeFileSync(
        configPath,
        JSON.stringify({ settings: { imageOutputPath: "../../evil/" } }, null, 2),
      );

      await expect(
        runCli([
          "import",
          "svg",
          inputPath,
          "-o",
          outputDir,
          "--format",
          "html",
          "--config",
          configPath,
        ]),
      ).rejects.toThrow(/\.\./);

      // Zero writes: no emitted HTML, no ir.json, no partial bundle — the
      // output directory was never created.
      expect(existsSync(outputDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
