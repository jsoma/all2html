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
 * No copy survives. The last one was `plugins/after-effects/exporter.jsx`,
 * allowlisted on the grounds that ExtendScript cannot import TypeScript — true
 * of the *source*, but not of the shipped artifact: `build:after-effects` now
 * concatenates `dist/extendscript/all2html-ae-core.js` (rolled up from
 * `src/extendscript/ae-index.ts`) ahead of the exporter, so the exporter calls
 * the shared `escapeAttr` instead of a local `escapeHtmlAttr`. The allowlist is
 * down to the module itself, and a re-fork in the AE exporter now fails here.
 */
const REPO_ROOT = resolve(import.meta.dirname, "../..");

const SCANNED_DIRECTORIES = ["src", "plugins", "apps", "scripts", "test"];

const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".svelte"];

const SKIPPED_DIRECTORY_NAMES = new Set(["node_modules", "dist", "cep", ".vite", "build"]);

/** The only file allowed to define an HTML escaper. */
const ALLOWED_DEFINITION_FILES = new Set(["src/emitters/shared/escape.ts"]);

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

  it("still finds the allowlisted definitions, so the scan is not vacuous", () => {
    const escapeModule = readFileSync(resolve(REPO_ROOT, "src/emitters/shared/escape.ts"), "utf-8");
    expect(escapeModule).toMatch(/export function escapeAttr\(/);
    expect(escapeModule).toMatch(/export function escapeHtml\(/);
  });

  it("would catch a re-fork in the After Effects exporter", () => {
    // The file that used to be allowlisted. Asserting the pattern *would* match
    // it keeps this from becoming a test that passes because the scanner is
    // broken rather than because the fork is gone.
    const planted = "  function escapeHtmlAttr(value) {\n    return value;\n  }\n";
    DEFINITION_PATTERN.lastIndex = 0;
    expect(DEFINITION_PATTERN.test(planted)).toBe(true);
    expect(ALLOWED_DEFINITION_FILES.has("plugins/after-effects/exporter.jsx")).toBe(false);

    const afterEffects = readFileSync(
      resolve(REPO_ROOT, "plugins/after-effects/exporter.jsx"),
      "utf-8",
    );
    expect(afterEffects).not.toMatch(/function escapeHtmlAttr\(/);
    // ...and it uses the shared one instead of quietly dropping the escaping.
    expect(afterEffects).toMatch(/\.escapeAttr\(/);
  });

  it("scans a meaningful number of files", () => {
    const files: string[] = [];
    for (const dir of SCANNED_DIRECTORIES) {
      collectSourceFiles(resolve(REPO_ROOT, dir), files);
    }
    expect(files.length).toBeGreaterThan(100);
  });
});
