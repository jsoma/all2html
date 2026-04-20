import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { importSVGFiles } from "../../src/importers/svg/import.js";

function waitFor(condition: () => boolean, timeoutMs: number = 8000): Promise<void> {
  const started = Date.now();

  return new Promise((resolvePromise, reject) => {
    const poll = () => {
      if (condition()) {
        resolvePromise();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Timed out waiting for condition."));
        return;
      }
      setTimeout(poll, 100);
    };

    poll();
  });
}

describe("all2html watch", () => {
  it("rebuilds when the config file changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "all2html-watch-config-"));
    const irPath = join(root, "story.ir.json");
    const configPath = join(root, "all2html.config.json");
    const outputDir = join(root, "out");

    const imported = await importSVGFiles(
      [
        {
          path: "story.svg",
          content:
            '<svg width="320" height="180" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="180" fill="#ddd"/><text x="24" y="48" font-size="24">Watch config</text></svg>',
        },
      ],
      { entrypointPaths: ["story.svg"], slug: "story" },
    );

    writeFileSync(irPath, JSON.stringify(imported.document, null, 2));
    writeFileSync(configPath, JSON.stringify({ emit: { react: { typescript: false } } }, null, 2));

    const child = spawn(
      "pnpm",
      [
        "exec",
        "tsx",
        "src/cli/index.ts",
        "watch",
        irPath,
        "-o",
        outputDir,
        "--format",
        "react",
        "--config",
        configPath,
      ],
      {
        cwd: resolve(import.meta.dirname, "../.."),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    try {
      await waitFor(() => existsSync(join(outputDir, "story.jsx")));

      writeFileSync(configPath, JSON.stringify({ emit: { react: { typescript: true } } }, null, 2));

      await waitFor(() => existsSync(join(outputDir, "story.tsx")));
      expect(stderr).toBe("");
    } finally {
      child.kill("SIGTERM");
      rmSync(root, { recursive: true, force: true });
    }
  });
});
