/**
 * Verifies that every source citation in the tracked prose docs still points at
 * code that supports the claim around it.
 *
 * The docs cite source locations constantly — `internal-docs/capability-matrix.md`
 * is nothing but citations — and CLAUDE.md tells readers to consult them before
 * assuming a setting works. Bare `file:line` citations rot the moment anyone
 * edits the cited file, and they rot silently: nothing reads them. This branch
 * has now had the same class of defect fixed three times by hand, each pass
 * lasting until the next commit that touched `exporter.jsx`.
 *
 * ## Citation syntax
 *
 * Two forms are recognized, both inside backticks:
 *
 *   1. Line citation — `path:12`, `path:12-34`, `path:12,34-40`
 *   2. Symbol citation — `path#symbolName`, or the prose form
 *      `` `symbolName` in `path` ``
 *
 * `path` may be written repo-relative (`src/emitters/shared/css.ts`) or as any
 * unambiguous trailing path fragment (`shared/css.ts`, `css.ts`). A fragment
 * that matches more than one tracked file is an error: `exporter.jsx` alone is
 * ambiguous between the Illustrator and After Effects exporters, and the docs
 * used it for both.
 *
 * ## The rule ("plausibly supports")
 *
 * Deliberately mechanical, and tuned for low false positives rather than for
 * catching every stale citation:
 *
 *   - Line citation: every cited line or range must be inside the file, and
 *     must contain at least one *anchor* identifier. Anchors are the identifiers
 *     inside other backticked spans within 240 characters of the citation on the
 *     same markdown line — in practice, the setting key or symbol the table row
 *     or sentence is about, minus the `GENERIC_ANCHORS` stoplist below.
 *     Comparison is on identifier tokens, normalized by
 *     lowercasing and dropping `_`/`-`, so a doc naming the canonical
 *     `pngTransparent` matches ExtendScript's `png_transparent`.
 *   - Symbol citation: the symbol must appear as a whole identifier token
 *     somewhere in the cited file (same normalization).
 *
 * A citation with no anchors at all cannot be verified and is reported as a
 * failure; the fix is to name the thing being pointed at, which is what makes
 * the citation useful to a reader anyway.
 *
 * ## Preferred fix
 *
 * Prefer symbol citations. They survive every edit that does not rename or
 * delete the thing; line numbers survive nothing. Keep a line citation only when
 * the target genuinely has no name.
 *
 * Not checked: bare paths with no line or symbol (existence only would be a
 * different, cheaper check), and citations inside fenced code blocks, which are
 * skipped.
 *
 * Usage:
 *   pnpm check:doc-citations            # fail on any broken citation
 *   pnpm check:doc-citations --verbose  # also print every citation that passed
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

/** Docs that carry citations. Globs are resolved against the tracked file list. */
export const DEFAULT_DOC_PATTERNS = [
  "CLAUDE.md",
  "PROGRESS.md",
  "SPEC.md",
  "internal-docs/*.md",
  // The nested CLAUDE.md files are the per-directory contracts, and they cite
  // code as heavily as the root one does. They were excluded until the single
  // stale citation in src/emitters/CLAUDE.md was converted to a symbol.
  "*/CLAUDE.md",
  "*/*/CLAUDE.md",
  "*/*/*/CLAUDE.md",
];

/** How far from a citation to look for the identifier it is meant to support. */
const ANCHOR_WINDOW = 240;

export interface CitationFailure {
  /** Doc file, repo-relative. */
  doc: string;
  /** 1-based line in the doc. */
  line: number;
  /** The citation exactly as written. */
  citation: string;
  reason: string;
}

export interface CheckOptions {
  root?: string;
  /** Repo-relative doc paths to scan. Defaults to `DEFAULT_DOC_PATTERNS`. */
  docs?: string[];
  /** Tracked file list, repo-relative. Defaults to `git ls-files`. */
  repoFiles?: string[];
}

export interface CheckResult {
  failures: CitationFailure[];
  /** Every citation that passed, as `doc:line -> citation`. */
  passed: string[];
}

/* ------------------------------------------------------------------ */
/* Citation grammar                                                    */
/* ------------------------------------------------------------------ */

const PATH_CHARS = "[A-Za-z0-9_@./-]+\\.[A-Za-z]{2,7}";
const LINE_CITATION = new RegExp(
  `\`(${PATH_CHARS}):((?:\\d+(?:-\\d+)?)(?:,\\d+(?:-\\d+)?)*)\``,
  "g",
);
const SYMBOL_HASH_CITATION = new RegExp(`\`(${PATH_CHARS})#([A-Za-z_$][A-Za-z0-9_$]*)\``, "g");
const SYMBOL_PROSE_CITATION = new RegExp(
  `\`([A-Za-z_$][A-Za-z0-9_$]*)\`\\s+in\\s+\`(${PATH_CHARS})\``,
  "g",
);
const BACKTICKED = /`([^`]+)`/g;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function normalize(token: string): string {
  return token.toLowerCase().replace(/[_-]/g, "");
}

/**
 * Words too common in this codebase to be evidence of anything. Without this,
 * `settings.imageFormat` lends the anchor `settings`, which matches
 * `data-more-settings-panel` twenty lines from the control being cited — the
 * citation passes while pointing at the wrong thing.
 */
const GENERIC_ANCHORS = new Set([
  "boolean",
  "config",
  "const",
  "data",
  "doc",
  "document",
  "export",
  "false",
  "file",
  "function",
  "json",
  "name",
  "null",
  "number",
  "option",
  "options",
  "path",
  "return",
  "setting",
  "settings",
  "src",
  "string",
  "this",
  "true",
  "type",
  "undefined",
  "value",
  "values",
]);

function identifierTokens(text: string): string[] {
  return text.split(/[^A-Za-z0-9_$]+/).filter((token) => token.length >= 3);
}

function anchorTokens(text: string): string[] {
  return identifierTokens(text).filter((token) => !GENERIC_ANCHORS.has(token.toLowerCase()));
}

function looksLikePath(span: string): boolean {
  return span.includes("/") || /\.[A-Za-z]{2,7}(?::|#|$)/.test(span);
}

function listTrackedFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function expandDocs(patterns: string[], repoFiles: string[]): string[] {
  const docs: string[] = [];
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      docs.push(pattern);
      continue;
    }
    const matcher = new RegExp(`^${pattern.replace(/[.]/g, "\\.").replace(/\*/g, "[^/]*")}$`);
    for (const file of repoFiles) {
      if (matcher.test(file)) docs.push(file);
    }
  }
  return [...new Set(docs)].sort();
}

/** Resolves a written path fragment to exactly one tracked file. */
function resolveCitedPath(
  written: string,
  repoFiles: Set<string>,
  repoFileList: string[],
): { path: string } | { error: string } {
  if (repoFiles.has(written)) return { path: written };
  const suffix = `/${written}`;
  const matches = repoFileList.filter((file) => file.endsWith(suffix));
  if (matches.length === 1) return { path: matches[0] };
  if (matches.length === 0) {
    return { error: `no tracked file matches \`${written}\`` };
  }
  return {
    error: `\`${written}\` is ambiguous — it matches ${matches.length} tracked files (${matches
      .slice(0, 4)
      .join(", ")}${matches.length > 4 ? ", …" : ""}). Write enough of the path to disambiguate.`,
  };
}

/** Strips fenced code blocks, keeping line numbering intact. */
function blankFencedCode(lines: string[]): string[] {
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return "";
    }
    return inFence ? "" : line;
  });
}

/**
 * Identifiers that the citation is expected to point at: everything inside
 * other backticked spans near it on the same line, falling back to the whole
 * line when the window is empty.
 */
function anchorsFor(line: string, citationIndex: number, citation: string): string[] {
  const collect = (from: number, to: number): string[] => {
    const anchors: string[] = [];
    BACKTICKED.lastIndex = 0;
    let match: RegExpExecArray | null = BACKTICKED.exec(line);
    while (match !== null) {
      const span = match[1];
      const start = match.index;
      const inWindow = start + span.length >= from && start <= to;
      if (inWindow && `\`${span}\`` !== citation && !looksLikePath(span)) {
        anchors.push(...anchorTokens(span));
      }
      match = BACKTICKED.exec(line);
    }
    return anchors;
  };

  const near = collect(citationIndex - ANCHOR_WINDOW, citationIndex + ANCHOR_WINDOW);
  if (near.length > 0) return near;
  return collect(0, line.length);
}

function parseParts(spec: string): Array<{ start: number; end: number; text: string }> {
  return spec.split(",").map((part) => {
    const [start, end] = part.split("-");
    return {
      start: Number.parseInt(start, 10),
      end: Number.parseInt(end ?? start, 10),
      text: part,
    };
  });
}

const FIX_HINT =
  "Fix by re-deriving the location, or — better — replace it with a symbol citation " +
  "(`path#symbolName`, or `` `symbolName` in `path` ``), which survives edits that move lines.";

/* ------------------------------------------------------------------ */
/* Check                                                               */
/* ------------------------------------------------------------------ */

export function checkDocCitations(options: CheckOptions = {}): CheckResult {
  const root = options.root ?? DEFAULT_ROOT;
  const repoFileList = options.repoFiles ?? listTrackedFiles(root);
  const repoFiles = new Set(repoFileList);
  const docs = expandDocs(options.docs ?? DEFAULT_DOC_PATTERNS, repoFileList);

  const failures: CitationFailure[] = [];
  const passed: string[] = [];
  const sourceCache = new Map<string, string[]>();

  const sourceLines = (path: string): string[] => {
    let lines = sourceCache.get(path);
    if (!lines) {
      lines = readFileSync(resolve(root, path), "utf8").split("\n");
      sourceCache.set(path, lines);
    }
    return lines;
  };

  for (const doc of docs) {
    const docLines = blankFencedCode(readFileSync(resolve(root, doc), "utf8").split("\n"));

    docLines.forEach((line, index) => {
      const lineNumber = index + 1;
      const fail = (citation: string, reason: string): void => {
        failures.push({ doc, line: lineNumber, citation, reason });
      };

      /* --- symbol citations --- */
      const symbolCitations: Array<{ text: string; symbol: string; written: string }> = [];
      for (const match of line.matchAll(SYMBOL_HASH_CITATION)) {
        symbolCitations.push({ text: match[0], written: match[1], symbol: match[2] });
      }
      for (const match of line.matchAll(SYMBOL_PROSE_CITATION)) {
        symbolCitations.push({ text: match[0], written: match[2], symbol: match[1] });
      }
      for (const { text, written, symbol } of symbolCitations) {
        const resolved = resolveCitedPath(written, repoFiles, repoFileList);
        if ("error" in resolved) {
          fail(text, resolved.error);
          continue;
        }
        const tokens = new Set(
          identifierTokens(sourceLines(resolved.path).join("\n")).map(normalize),
        );
        if (!tokens.has(normalize(symbol))) {
          fail(
            text,
            `\`${resolved.path}\` contains no identifier \`${symbol}\`. ` +
              "Either the symbol was renamed or deleted, or the citation names the wrong file.",
          );
          continue;
        }
        passed.push(`${doc}:${lineNumber} ${text}`);
      }

      /* --- line citations --- */
      for (const match of line.matchAll(LINE_CITATION)) {
        const text = match[0];
        const written = match[1];
        const resolved = resolveCitedPath(written, repoFiles, repoFileList);
        if ("error" in resolved) {
          fail(text, `${resolved.error} ${FIX_HINT}`);
          continue;
        }
        const lines = sourceLines(resolved.path);
        const anchors = anchorsFor(line, match.index, text);
        if (anchors.length === 0) {
          fail(
            text,
            "nothing near this citation names what it points at, so it cannot be verified. " +
              "Put the identifier or setting key it supports in backticks beside it, or use a " +
              "symbol citation (`path#symbolName`).",
          );
          continue;
        }
        const wantedTokens = new Set(anchors.map(normalize));

        let broken = false;
        for (const part of parseParts(match[2])) {
          if (part.start < 1 || part.end > lines.length || part.end < part.start) {
            fail(
              text,
              `\`${resolved.path}\` has ${lines.length} lines; \`${part.text}\` is out of range. ${FIX_HINT}`,
            );
            broken = true;
            break;
          }
          const haystack = lines.slice(part.start - 1, part.end).join("\n");
          const present = identifierTokens(haystack).map(normalize);
          if (!present.some((token) => wantedTokens.has(token))) {
            fail(
              text,
              `\`${resolved.path}\` line${part.start === part.end ? "" : "s"} ${part.text} ` +
                `mentions none of ${[...new Set(anchors)]
                  .slice(0, 6)
                  .map((anchor) => `\`${anchor}\``)
                  .join(", ")}. ${FIX_HINT}`,
            );
            broken = true;
            break;
          }
        }
        if (!broken) passed.push(`${doc}:${lineNumber} ${text}`);
      }
    });
  }

  return { failures, passed };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function main(): void {
  const verbose = process.argv.includes("--verbose");
  const { failures, passed } = checkDocCitations();

  if (verbose) {
    for (const entry of passed) console.log(`  ok  ${entry}`);
  }

  if (failures.length > 0) {
    console.error(`\nBroken source citations: ${failures.length}\n`);
    for (const failure of failures) {
      console.error(`${failure.doc}:${failure.line}  ${failure.citation}`);
      console.error(`    ${failure.reason}\n`);
    }
    console.error(
      "Docs citations are checked by scripts/check-doc-citations.ts. " +
        "Read its header for the exact rule.",
    );
    process.exit(1);
  }

  console.log(`Doc citations OK: ${passed.length} verified.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
