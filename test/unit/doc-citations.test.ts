import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkDocCitations } from "../../scripts/check-doc-citations.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Fixture repo: a doc plus the source files it cites. `repoFiles` is passed
 * explicitly so the check never shells out to git for these cases.
 */
function makeRepo(files: Record<string, string>): { root: string; repoFiles: string[] } {
  const root = mkdtempSync(join(tmpdir(), "doc-citations-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return { root, repoFiles: Object.keys(files) };
}

const SOURCE = [
  "export function resolveImageFormat(settings) {", // 1
  "  return settings.imageFormat;", // 2
  "}", // 3
  "", // 4
  "const unrelated = 1;", // 5
].join("\n");

describe("doc citation checker", () => {
  const roots: string[] = [];

  function check(doc: string) {
    const repo = makeRepo({ "DOC.md": doc, "src/thing.ts": SOURCE });
    roots.push(repo.root);
    return checkDocCitations({ root: repo.root, docs: ["DOC.md"], repoFiles: repo.repoFiles });
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("accepts a line citation whose lines mention the identifier beside it", () => {
    const result = check("| `imageFormat` | yes `src/thing.ts:2` |");
    expect(result.failures).toEqual([]);
    expect(result.passed).toHaveLength(1);
  });

  it("rejects a line citation that has drifted onto unrelated code", () => {
    // The single defect this check exists for: the line number is real, the file
    // is real, and the code there has nothing to do with the claim.
    const result = check("| `imageFormat` | yes `src/thing.ts:5` |");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].citation).toBe("`src/thing.ts:5`");
    expect(result.failures[0].reason).toContain("mentions none of");
    // The message has to say what to do about it.
    expect(result.failures[0].reason).toContain("symbol citation");
  });

  it("rejects a line citation past the end of the file", () => {
    const result = check("`imageFormat` is read at `src/thing.ts:900`.");
    expect(result.failures[0].reason).toContain("out of range");
  });

  it("rejects a range where any part misses", () => {
    const result = check("| `imageFormat` | yes `src/thing.ts:1-2,4-5` |");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toContain("4-5");
  });

  it("rejects a citation with nothing near it to verify against", () => {
    const result = check("See `src/thing.ts:2` for the details.");
    expect(result.failures[0].reason).toContain("cannot be verified");
  });

  it("matches across snake_case and camelCase spellings of the same key", () => {
    const repo = makeRepo({
      "DOC.md": "| `pngTransparent` | yes `x.jsx:1` |",
      "x.jsx": 'var t = docSettings.png_transparent === "true";',
    });
    roots.push(repo.root);
    expect(
      checkDocCitations({ root: repo.root, docs: ["DOC.md"], repoFiles: repo.repoFiles }).failures,
    ).toEqual([]);
  });

  it("rejects a path fragment that matches more than one file", () => {
    const repo = makeRepo({
      "DOC.md": "| `imageFormat` | yes `exporter.jsx:1` |",
      "a/exporter.jsx": "var imageFormat = 1;",
      "b/exporter.jsx": "var imageFormat = 2;",
    });
    roots.push(repo.root);
    const result = checkDocCitations({
      root: repo.root,
      docs: ["DOC.md"],
      repoFiles: repo.repoFiles,
    });
    expect(result.failures[0].reason).toContain("ambiguous");
  });

  it("accepts both symbol citation forms and rejects a missing symbol", () => {
    expect(check("| `imageFormat` | yes `src/thing.ts#resolveImageFormat` |").failures).toEqual([]);
    expect(check("`resolveImageFormat` in `src/thing.ts` decides it.").failures).toEqual([]);
    const gone = check("`resolveImageFormat` in `src/thing.ts`, renamed to `pickFormat`.");
    expect(gone.failures).toEqual([]);
    const missing = check("| x | `src/thing.ts#pickFormat` |");
    expect(missing.failures).toHaveLength(1);
    expect(missing.failures[0].reason).toContain("contains no identifier");
  });

  it("ignores citations inside fenced code blocks", () => {
    const result = check(["```", "see src/thing.ts:900", "`src/thing.ts:900`", "```"].join("\n"));
    expect(result.failures).toEqual([]);
  });

  it("passes over the repository's own docs", () => {
    const result = checkDocCitations({ root: repoRoot });
    const report = result.failures
      .map((failure) => `${failure.doc}:${failure.line} ${failure.citation} — ${failure.reason}`)
      .join("\n");
    expect(report).toBe("");
    // Non-vacuous: the docs really do carry citations.
    expect(result.passed.length).toBeGreaterThan(50);
  });
});
