import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, writePlannedFiles } from "../../src/cli/run.js";

/**
 * The CLI argument grammar (`parseCommandArgs` in `src/cli/run.ts`), driven
 * through `runCli` because the parser is deliberately not exported: what
 * matters is that every command rejects bad grammar before doing any work.
 *
 * The old hand-rolled loops silently ignored unknown flags and stray
 * positionals, let a duplicate flag last-win, and let a trailing valueless flag
 * ride `undefined` into the pipeline — which on `import`/`watch` escaped the
 * `try` and died as an unhandled rejection with a stack trace.
 */
describe("CLI argument grammar", () => {
  it.each([
    ["render", ["render", "story.json", "--bogus"]],
    ["watch", ["watch", "story.json", "--bogus"]],
    ["import", ["import", "svg", "story.svg", "--bogus"]],
    ["validate", ["validate", "story.json", "--bogus"]],
  ])("rejects an unknown flag on %s", async (command, args) => {
    await expect(runCli(args)).rejects.toThrow(`unknown option "--bogus" for "${command}"`);
  });

  // `validate` takes no flags at all — it used to read `args[1]` and silently
  // ignore everything else on the line.
  it("rejects a flag the other commands accept on validate", async () => {
    await expect(runCli(["validate", "story.json", "--verbose"])).rejects.toThrow(
      'unknown option "--verbose" for "validate"',
    );
  });

  it("rejects a duplicate scalar flag, across its spellings", async () => {
    await expect(runCli(["render", "story.json", "-o", "a", "--output", "b"])).rejects.toThrow(
      'option "--output" was given more than once',
    );
  });

  it("rejects a trailing valueless flag instead of riding undefined into the pipeline", async () => {
    await expect(runCli(["render", "story.json", "--format"])).rejects.toThrow(
      'missing value for "--format"',
    );
  });

  it("rejects a flag whose value is the next flag", async () => {
    await expect(runCli(["import", "svg", "story.svg", "--format", "-o"])).rejects.toThrow(
      'missing value for "--format"',
    );
  });

  it.each([
    ["render", ["render", "story.json", "extra.json"], "extra.json"],
    ["watch", ["watch", "story.json", "extra.json"], "extra.json"],
    ["import", ["import", "svg", "story.svg", "extra.svg"], "extra.svg"],
    ["validate", ["validate", "story.json", "extra.json"], "extra.json"],
  ])("rejects a stray positional on %s", async (_command, args, stray) => {
    await expect(runCli(args)).rejects.toThrow(`unexpected argument "${stray}"`);
  });

  it("names the missing positional", async () => {
    await expect(runCli(["render"])).rejects.toThrow('missing IR file path for "render"');
    await expect(runCli(["import", "svg"])).rejects.toThrow('missing input path for "import"');
  });

  it("rejects an unknown command", async () => {
    await expect(runCli(["frobnicate"])).rejects.toThrow("unknown command: frobnicate");
  });
});

/**
 * The process contract lives in the bin entry (`src/cli/index.ts`): every
 * failure — parse errors included — exits 1 with a single concise
 * `Error: <message>` line, never a stack trace. Asserted with exact stderr
 * equality, which any stack frame would break.
 */
describe("CLI process contract", () => {
  const repoRoot = resolve(import.meta.dirname, "../..");

  it.each([
    ["render", ["render", "story.json", "--bogus"]],
    ["watch", ["watch", "story.json", "--bogus"]],
    ["import", ["import", "svg", "story.svg", "--bogus"]],
    ["validate", ["validate", "story.json", "--bogus"]],
  ])("%s exits 1 with one concise error line and no stack trace", (command, args) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], {
      cwd: repoRoot,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`Error: unknown option "--bogus" for "${command}"\n`);
  });
});

/**
 * The write half of every command: all destinations are resolved and
 * containment-checked before the first directory or file is created, so a
 * containment failure means zero writes — not "file 1 is on disk before file
 * 2's check throws", which is what running the check inside the write loop
 * produced.
 */
describe("writePlannedFiles", () => {
  it("writes nothing when any planned path escapes the output directory", () => {
    const root = mkdtempSync(join(tmpdir(), "all2html-planned-writes-"));
    const outputDir = join(root, "out");

    try {
      expect(() =>
        writePlannedFiles(outputDir, [
          { path: "first.html", data: "one" },
          { path: "../evil.html", data: "two" },
        ]),
      ).toThrow(/resolves outside the output directory/);

      // Zero writes: not even the file whose path was fine.
      expect(existsSync(join(outputDir, "first.html"))).toBe(false);
      expect(existsSync(join(root, "evil.html"))).toBe(false);
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes every file when all planned paths are contained", () => {
    const root = mkdtempSync(join(tmpdir(), "all2html-planned-writes-"));
    const outputDir = join(root, "out");

    try {
      writePlannedFiles(outputDir, [
        { path: "index.html", data: "page" },
        { path: "nested/asset.txt", data: "asset" },
      ]);

      expect(readFileSync(join(outputDir, "index.html"), "utf-8")).toBe("page");
      expect(readFileSync(join(outputDir, "nested", "asset.txt"), "utf-8")).toBe("asset");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
