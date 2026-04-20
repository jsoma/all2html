import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("all2html import svg CLI", () => {
  it("writes ir.json, emitted html, and extracted assets", () => {
    const root = mkdtempSync(join(tmpdir(), "all2html-svg-cli-"));
    const inputPath = join(root, "story.svg");
    const outputDir = join(root, "out");

    try {
      writeFileSync(
        inputPath,
        '<svg width="320" height="180" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="180" fill="#ddd"/><text x="24" y="48" font-size="24">CLI import</text></svg>',
      );

      const result = spawnSync(
        "pnpm",
        [
          "exec",
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
      expect(readFileSync(join(outputDir, "story.html"), "utf-8")).toContain("CLI import");
      expect(readFileSync(join(outputDir, "story.html"), "utf-8")).toContain(
        "all2html-output/story.png",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
