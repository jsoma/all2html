import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * There is exactly one HTML escaping module, `src/emitters/shared/escape.ts`,
 * and it splits the two grammars deliberately: `escapeHtml()` covers hast's
 * text-node subset (`&`, `<`) and `escapeAttr()` covers hast's double-quoted
 * attribute subset (NUL, `"`, `&`, `'`, backtick). A local copy is how the two
 * grammars get confused — the svg-dropzone copy escaped `"` and was used in an
 * attribute position, so replacing it with the narrowed shared `escapeHtml`
 * would have opened a hole. Both browser surfaces now import the pair.
 *
 * One copy legitimately survives: the After Effects exporter is ExtendScript
 * evaluated by the host and cannot import TypeScript. It is allowlisted by
 * path, not by pattern, so a new fork anywhere else fails here.
 */
const REPO_ROOT = resolve(import.meta.dirname, "../..");

const SCANNED_DIRECTORIES = ["src", "plugins", "apps", "scripts", "test"];

const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".svelte"];

const SKIPPED_DIRECTORY_NAMES = new Set(["node_modules", "dist", "cep", ".vite", "build"]);

/** The only two files allowed to define an HTML escaper. */
const ALLOWED_DEFINITION_FILES = new Set([
  "src/emitters/shared/escape.ts",
  "plugins/after-effects/exporter.jsx",
]);

/**
 * `function escapeX(`, `const escapeX =`, `escapeX: function (` and the object
 * shorthand `escapeX(value) {`. Matches only HTML-ish escaper names, so
 * `escapeTemplateLiteral` / `escapeScriptContent` (real, distinct grammars that
 * live inside the allowed module) are not swept up.
 */
const DEFINITION_PATTERN =
  /(?:function\s+|(?:const|let|var)\s+|^\s*)escape[A-Za-z]*(?:Html|HTML|Attr|Xml|XML)[A-Za-z]*\s*(?:[=(]|:\s*function)/gm;

function collectSourceFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRECTORY_NAMES.has(entry)) continue;
    const full = resolve(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
}

function findEscapeDefinitions(): string[] {
  const files: string[] = [];
  for (const dir of SCANNED_DIRECTORIES) {
    collectSourceFiles(resolve(REPO_ROOT, dir), files);
  }

  const offenders: string[] = [];
  for (const file of files) {
    const relativePath = relative(REPO_ROOT, file).replace(/\\/g, "/");
    if (ALLOWED_DEFINITION_FILES.has(relativePath)) continue;
    if (relativePath === "test/unit/escape-single-source.test.ts") continue;

    const source = readFileSync(file, "utf-8");
    DEFINITION_PATTERN.lastIndex = 0;
    let match = DEFINITION_PATTERN.exec(source);
    while (match) {
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(`${relativePath}:${line} ${match[0].trim()}`);
      match = DEFINITION_PATTERN.exec(source);
    }
  }
  return offenders;
}

describe("HTML escaping is single-sourced", () => {
  it("defines no escapeHtml/escapeAttr/escapeXml outside the shared module", () => {
    expect(findEscapeDefinitions()).toEqual([]);
  });

  it("still finds the two allowlisted definitions, so the scan is not vacuous", () => {
    const escapeModule = readFileSync(resolve(REPO_ROOT, "src/emitters/shared/escape.ts"), "utf-8");
    expect(escapeModule).toMatch(/export function escapeAttr\(/);
    expect(escapeModule).toMatch(/export function escapeHtml\(/);

    const afterEffects = readFileSync(
      resolve(REPO_ROOT, "plugins/after-effects/exporter.jsx"),
      "utf-8",
    );
    expect(afterEffects).toMatch(/function escapeHtmlAttr\(/);
  });

  it("scans a meaningful number of files", () => {
    const files: string[] = [];
    for (const dir of SCANNED_DIRECTORIES) {
      collectSourceFiles(resolve(REPO_ROOT, dir), files);
    }
    expect(files.length).toBeGreaterThan(100);
  });
});
