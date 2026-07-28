/**
 * The inventory of everything that runs inside, or ships into, an ExtendScript
 * host — shared by every guard that has to scan "all of it".
 *
 * This lives in one place because the guards kept disagreeing about what "all of
 * it" meant. The ES5 runtime-API guard scanned five artifacts and four source
 * groups; the reserved-word guard scanned exactly one file
 * (`dist/extendscript/all2html-core.js`) and therefore could not see the `char`
 * parameter in `plugins/illustrator/exporter.jsx` that motivated it. A guard is
 * only as wide as its file list, so the file list is not a guard's private
 * business.
 *
 * Two kinds of target, and both matter:
 *
 *   - **Artifacts** are the built files an ExtendScript host actually evaluates.
 *     They are the ground truth for what ships, including the hand-written
 *     `.jsx` and the vendored json2 that get concatenated in.
 *   - **Sources** are what the artifacts are built from. Rollup tree-shakes, so a
 *     hazard in a module that is currently unreferenced does not appear in any
 *     artifact — it appears the moment a caller is added. The TypeScript side is
 *     walked from the bundle entry point rather than listed by directory, because
 *     `src/core` and `src/emitters` also hold Node-only modules that never enter
 *     this runtime.
 *
 * Not listed, deliberately: `dist/after-effects/all2html-ae.jsx` and the
 * `all2html-after-effects.zip` copy of it are byte-identical to the panel's
 * `jsx/all2html-ae.jsx` (vite copies that exact file), so scanning them again
 * would cost a second pass over 77 KB to assert the same bytes twice.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { repoRoot } from "./extendscript-build.js";

export interface Artifact {
  label: string;
  path: string;
  /** True when `installPolyfills()` from the core bundle runs in this artifact. */
  polyfilled: boolean;
  build: string;
  /**
   * Set only for artifacts that are *concatenated into* another artifact rather than
   * evaluated on their own, and so inherit that host's json2 polyfill. Everything
   * else must carry json2 itself if it touches `JSON` — ExtendScript has no native
   * `JSON` object, and `polyfills.ts` does not install one (the rollup banner does).
   */
  jsonFromHost?: true;
}

export const ARTIFACTS: Artifact[] = [
  {
    label: "core ExtendScript bundle",
    path: "dist/extendscript/all2html-core.js",
    polyfilled: true,
    build: "build:illustrator",
    // Never evaluated standalone: `build:illustrator` concatenates json2, the ES5
    // polyfills, this bundle and the exporter into `dist/all2html.js`.
    jsonFromHost: true,
  },
  {
    label: "assembled Illustrator bundle",
    path: "dist/all2html.js",
    polyfilled: true,
    build: "build:illustrator",
  },
  {
    label: "panel hostscript bundle",
    path: "plugins/illustrator/panel/dist/cep/jsx/hostscript.js",
    // The hostscript bundles json2 only — it must never assume the core
    // bundle's polyfills have been installed first.
    polyfilled: false,
    build: "build:panel",
  },
  {
    label: "core After Effects helper bundle",
    path: "dist/extendscript/all2html-ae-core.js",
    polyfilled: true,
    build: "build:illustrator",
    // Never evaluated standalone: `build:after-effects` concatenates the json2
    // string, the player template, this bundle and the exporter into
    // `dist/after-effects/all2html-ae.jsx`.
    jsonFromHost: true,
  },
  {
    label: "panel After Effects exporter bundle",
    path: "plugins/illustrator/panel/dist/cep/jsx/all2html-ae.jsx",
    // Since the After Effects exporter got the bundle slot (D13), this artifact
    // concatenates `dist/extendscript/all2html-ae-core.js` ahead of
    // `exporter.jsx`, and that bundle calls `installPolyfills()` at load.
    polyfilled: true,
    build: "build:panel",
  },
  {
    label: "panel core bundle copy",
    path: "plugins/illustrator/panel/dist/cep/jsx/all2html.js",
    polyfilled: true,
    build: "build:panel",
  },
];

export function listFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "lib" || entry === "node_modules") continue;
      out.push(...listFiles(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every module statically reachable from the ExtendScript bundle entry point.
 *
 * Scanning `dist/all2html.js` is necessary but not sufficient: rollup tree-shakes,
 * so a hazard in a module that ships but whose *function* is currently unreferenced
 * is invisible in the artifact. `src/emitters/shared/percentage-positions.ts` was
 * exactly that — `Number.parseFloat` in a module reached only when the documented
 * `positionMode: "percentage"` emitter option is set, dropped from the bundle today,
 * a TypeError in Illustrator the moment someone flips the option on. A source-level
 * scan does not care what the optimizer kept.
 *
 * The graph is walked rather than a directory listed, because `src/core` and
 * `src/emitters` also hold Node-only modules (`node:fs` importers, the hast
 * emitter) that never enter this runtime and would only teach us to add exclusions.
 * Reachability is the real question, and the entry point answers it exactly.
 */
export const EXTENDSCRIPT_ENTRY = resolve(repoRoot, "src/extendscript/index.ts");

/**
 * Both bundle entry points. `index.ts` is the Illustrator pipeline;
 * `ae-index.ts` is the helper-only bundle After Effects loads (D13). Every
 * module either one reaches is scanned, so an AE-only helper cannot slip past
 * the guards just because the Illustrator bundle never imports it.
 */
export const EXTENDSCRIPT_ENTRIES = [
  EXTENDSCRIPT_ENTRY,
  resolve(repoRoot, "src/extendscript/ae-index.ts"),
];

/**
 * Static import/export specifiers, anchored at statement starts so a specifier
 * quoted inside a doc comment (` * from "./x.js"`) is not mistaken for one.
 * `[^;]` keeps a lazy match from running past the end of its own statement.
 */
function importSpecifiers(code: string): string[] {
  const found: string[] = [];
  const patterns = [
    /^\s*(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(code);
    while (match) {
      found.push(match[1]);
      match = pattern.exec(code);
    }
  }
  return found;
}

function resolveModule(fromDir: string, specifier: string): string | null {
  const base = resolve(fromDir, specifier);
  const candidates = base.endsWith(".js")
    ? [`${base.slice(0, -3)}.ts`, base]
    : [`${base}.ts`, join(base, "index.ts"), base];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function collectReachableSources(entries: string | string[]): string[] {
  const seen = new Set<string>();
  const queue = Array.isArray(entries) ? [...entries] : [entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf-8");
    for (const specifier of importSpecifiers(code)) {
      if (specifier.charAt(0) !== ".") continue;
      const resolved = resolveModule(dirname(file), specifier);
      // A specifier this walker cannot resolve would silently shrink the scanned
      // set, which is the failure mode the whole group exists to prevent.
      if (!resolved) {
        throw new Error(`Unresolved import "${specifier}" in ${file.slice(repoRoot.length + 1)}`);
      }
      queue.push(resolved);
    }
  }
  return Array.from(seen).sort();
}

export const EXTENDSCRIPT_SOURCES = collectReachableSources(EXTENDSCRIPT_ENTRIES);

export interface SourceGroup {
  label: string;
  files: string[];
  polyfilled: boolean;
}

export const SOURCE_GROUPS: SourceGroup[] = [
  {
    label: "ExtendScript-bound TypeScript sources",
    files: EXTENDSCRIPT_SOURCES,
    // `installPolyfills()` is the first thing the bundle does.
    polyfilled: true,
  },
  {
    label: "panel hostscript sources",
    files: listFiles(resolve(repoRoot, "plugins/illustrator/panel/src/jsx"), [".ts", ".js"]),
    polyfilled: false,
  },
  {
    label: "After Effects exporter source",
    files: [resolve(repoRoot, "plugins/after-effects/exporter.jsx")],
    // Assembled after the After Effects helper bundle IIFE, which installs the
    // polyfills. It was `false` while the exporter loaded nothing at all.
    polyfilled: true,
  },
  {
    label: "Illustrator exporter source",
    files: [resolve(repoRoot, "plugins/illustrator/exporter.jsx")],
    // Assembled after the core bundle IIFE, which installs the polyfills.
    polyfilled: true,
  },
];

/**
 * Vendored ExtendScript that is not ours and is not scanned by the ES5 runtime
 * guard (`listFiles` skips `lib/`), but is still parsed by the host: json2 is
 * concatenated into the Illustrator bundle, the After Effects script and the
 * panel hostscript. A syntax-level guard has to see it; an API-level guard would
 * only relitigate douglascrockford/JSON-js.
 *
 * `plugins/illustrator/panel/src/jsx/lib/json2.js` is a byte-identical copy of
 * this file, so it is not listed twice.
 */
export const VENDORED_EXTENDSCRIPT = [resolve(repoRoot, "plugins/illustrator/json2.js")];
