import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfigFile } from "../../src/cli/config-file.js";
import { runCli, type WatchHandle } from "../../src/cli/run.js";
import { importSVGFiles } from "../../src/importers/svg/import.js";

// Spy, not replace: `runCli`'s watch path must call through to the real
// implementation; the spy only counts how often the config file is read.
vi.mock("../../src/cli/config-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cli/config-file.js")>();
  return {
    ...actual,
    readConfigFile: vi.fn(actual.readConfigFile),
  };
});

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
      process.execPath,
      [
        "--import",
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

/**
 * In-process watch runs, so the `readConfigFile` spy can count reads. The old
 * shape read and parsed the config **twice** per run/rebuild — once for
 * `.emit` in the CLI and once inside the pipeline via `configPath` — with a
 * torn-read window between the two reads.
 */
describe("all2html watch (in-process)", () => {
  const fixtureIr = readFileSync(
    resolve(import.meta.dirname, "../fixtures/ir/single-artboard-basic.json"),
    "utf-8",
  );

  let root: string;
  let handle: WatchHandle | undefined;

  afterEach(() => {
    handle?.close();
    handle = undefined;
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.mocked(readConfigFile).mockClear();
  });

  function countRebuilds(logSpy: ReturnType<typeof vi.spyOn>): number {
    return logSpy.mock.calls.filter((call) => String(call[0]).startsWith("Rebuilt")).length;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
  }

  /**
   * Rewrite `path` until `done` reports the watcher reacted. A single write
   * races macOS FSEvents subscription setup — a touch immediately after
   * `fs.watch()` can be silently missed — so the trigger retries at intervals
   * comfortably longer than the watcher's 200ms debounce.
   */
  async function touchUntil(path: string, content: string, done: () => boolean): Promise<void> {
    const started = Date.now();
    while (!done()) {
      if (Date.now() - started > 15000) {
        throw new Error("Timed out waiting for the watcher to rebuild.");
      }
      writeFileSync(path, content);
      await sleep(700);
    }
  }

  it("reads and parses the config exactly once per rebuild", { timeout: 20000 }, async () => {
    root = mkdtempSync(join(tmpdir(), "all2html-watch-once-"));
    const irPath = join(root, "story.ir.json");
    const configPath = join(root, "all2html.config.json");
    const outputDir = join(root, "out");
    writeFileSync(irPath, fixtureIr);
    writeFileSync(configPath, JSON.stringify({ settings: { maxWidth: 640 } }, null, 2));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    handle = await runCli([
      "watch",
      irPath,
      "-o",
      outputDir,
      "--format",
      "html",
      "--config",
      configPath,
    ]);

    await waitFor(() => countRebuilds(logSpy) >= 1);
    expect(vi.mocked(readConfigFile)).toHaveBeenCalledTimes(1);

    // Touch the IR to trigger a rebuild (same document, new bytes).
    await touchUntil(irPath, `${fixtureIr}\n`, () => countRebuilds(logSpy) >= 2);

    // One read per rebuild — however many rebuilds the watcher coalesced the
    // changes into, the counts must match, not double. Rebuilds are synchronous
    // start to finish, so the two counters cannot be observed mid-rebuild.
    expect(vi.mocked(readConfigFile)).toHaveBeenCalledTimes(countRebuilds(logSpy));
  });

  it("leaves the prior output intact when a rebuild fails", { timeout: 20000 }, async () => {
    root = mkdtempSync(join(tmpdir(), "all2html-watch-fail-"));
    const irPath = join(root, "story.ir.json");
    const outputDir = join(root, "out");
    writeFileSync(irPath, fixtureIr);

    vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    handle = await runCli(["watch", irPath, "-o", outputDir, "--format", "html"]);

    const outputPath = join(outputDir, "test-graphic.html");
    await waitFor(() => existsSync(outputPath));
    const goodOutput = readFileSync(outputPath, "utf-8");

    // Break the IR: the rebuild fails before anything is written, so the last
    // successful output stays on disk untouched.
    await touchUntil(irPath, "{ this is not JSON", () =>
      errorSpy.mock.calls.some((call) => String(call[0]).startsWith("Rebuild error")),
    );

    expect(readFileSync(outputPath, "utf-8")).toBe(goodOutput);
  });
});
