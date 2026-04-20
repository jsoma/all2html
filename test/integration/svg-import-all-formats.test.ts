import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("all2html import svg emitters", () => {
  const formats = ["html", "standalone", "svelte", "react"] as const;

  for (const format of formats) {
    it(`imports svg and emits ${format}`, () => {
      const root = mkdtempSync(join(tmpdir(), `all2html-svg-${format}-`));
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
            format,
          ],
          {
            cwd: resolve(import.meta.dirname, "../.."),
            encoding: "utf-8",
          },
        );

        expect(result.status).toBe(0);
        const files = readdirSync(outputDir).sort();
        expect(files).toContain("ir.json");
        if (format === "html" || format === "standalone") {
          expect(files).toContain("story.html");
          expect(readFileSync(join(outputDir, "story.html"), "utf-8")).toContain("CLI import");
        } else if (format === "svelte") {
          expect(files).toContain("story.svelte");
          expect(readFileSync(join(outputDir, "story.svelte"), "utf-8")).toContain("$props()");
        } else {
          expect(files).toContain("story.jsx");
          expect(readFileSync(join(outputDir, "story.jsx"), "utf-8")).toContain(
            "export default function",
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
