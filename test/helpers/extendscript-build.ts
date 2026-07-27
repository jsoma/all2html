/**
 * Build-on-demand helpers for tests that inspect ExtendScript build artifacts.
 *
 * Artifacts are rebuilt when they are **missing or older than their inputs**.
 * Existence alone is not enough: a `dist/` left over from an earlier build lets
 * a guard pass while the current sources contain a violation, and local
 * development — where someone edits ExtendScript and re-runs the tests — is
 * exactly where that matters.
 *
 * Each build script runs at most once per test run (per process), and a
 * filesystem lock keeps parallel vitest workers from building concurrently or
 * from reading a half-written artifact.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const repoRoot = resolve(import.meta.dirname, "../..");

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/** Inputs of `build:extendscript` (see tsconfig.extendscript.json). */
const CORE_INPUTS = [
  "src/extendscript",
  "src/core",
  "src/emitters",
  "src/ir",
  "tsconfig.extendscript.json",
  "scripts/build-extendscript.mjs",
];

const ILLUSTRATOR_INPUTS = [
  ...CORE_INPUTS,
  "plugins/illustrator/exporter.jsx",
  "plugins/illustrator/json2.js",
  "scripts/assemble-illustrator.mjs",
];

/** Inputs of `build:after-effects` (core bundle + the AE plugin sources). */
const AFTER_EFFECTS_INPUTS = [
  ...CORE_INPUTS,
  "plugins/after-effects",
  "plugins/illustrator/json2.js",
  "scripts/package-after-effects.mjs",
];

const PANEL_INPUTS = [
  ...ILLUSTRATOR_INPUTS,
  "plugins/after-effects",
  "scripts/package-after-effects.mjs",
  "plugins/illustrator/panel/src",
  "plugins/illustrator/panel/public",
  "plugins/illustrator/panel/cep.config.ts",
  "plugins/illustrator/panel/vite.config.ts",
  "plugins/illustrator/panel/vite.es.config.ts",
  "plugins/illustrator/panel/package.json",
];

/** Inputs per build script, and the builds each one transitively runs. */
const BUILDS: Record<string, { inputs: string[]; alsoRuns: string[] }> = {
  build: { inputs: ["src", "tsconfig.build.json"], alsoRuns: [] },
  "build:extendscript": { inputs: CORE_INPUTS, alsoRuns: [] },
  "build:illustrator": { inputs: ILLUSTRATOR_INPUTS, alsoRuns: ["build:extendscript"] },
  "build:after-effects": { inputs: AFTER_EFFECTS_INPUTS, alsoRuns: ["build:extendscript"] },
  "build:panel": {
    inputs: PANEL_INPUTS,
    alsoRuns: ["build:extendscript", "build:illustrator", "build:after-effects"],
  },
};

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".tmp"]);

function newestMtime(paths: string[]): number {
  let newest = 0;
  const walk = (full: string): void => {
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(full)) {
        if (SKIP_DIRS.has(entry)) continue;
        walk(join(full, entry));
      }
      return;
    }
    if (stat.mtimeMs > newest) newest = stat.mtimeMs;
  };
  for (const path of paths) walk(resolve(repoRoot, path));
  return newest;
}

/**
 * A build spawned from a test must see the same environment a developer's shell
 * would. Vitest sets `NODE_ENV=test`, which flips `vite-cep-plugin` into its
 * serve behaviour and makes `pnpm build:panel` fail with ENOENT on
 * `dist/cep/main/index.html`.
 */
function buildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_ENV;
  return env;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Cross-process mutex so parallel vitest workers do not build concurrently.
 *
 * **One lock for every target, not one per target.** A per-target lock only
 * guards workers running the *same* build, and these builds are not
 * independent: `build:panel` runs `build:illustrator` and `build:after-effects`,
 * every one of them runs `build:extendscript`, and they all write into the same
 * `dist/` tree. Two workers taking two different locks would then have one
 * rewriting `dist/after-effects/all2html-ae.jsx` while the other reads it, which
 * is a truncated read reported as a size-budget failure — a flake that reads
 * exactly like a real finding. The serialization costs nothing real: the builds
 * were already effectively serialized by their shared work.
 */
function withBuildLock<T>(fn: () => T): T {
  const lockDir = resolve(repoRoot, ".tmp/test-builds", "extendscript.lock");
  mkdirSync(resolve(repoRoot, ".tmp/test-builds"), { recursive: true });

  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() > deadline) {
        // Stale lock from a crashed run — take it over.
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      sleepSync(100);
    }
  }

  try {
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/** Artifacts verified fresh in this process, keyed by absolute path. */
const verified = new Set<string>();
/** Build scripts already executed in this process. */
const ranBuilds = new Set<string>();
/** Builds that already failed — re-running them once per test only wastes time. */
const failures = new Map<string, Error>();

function isStale(artifactPath: string, build: string): boolean {
  if (!existsSync(artifactPath)) return true;
  const artifactMtime = statSync(artifactPath).mtimeMs;
  return artifactMtime < newestMtime(BUILDS[build].inputs);
}

function runBuild(build: string): void {
  const previousFailure = failures.get(build);
  if (previousFailure) throw previousFailure;
  try {
    withBuildLock(() => {
      if (ranBuilds.has(build)) return; // already built once — do not loop
      execFileSync(pnpm, [build], { cwd: repoRoot, stdio: "inherit", env: buildEnv() });
      ranBuilds.add(build);
      for (const implied of BUILDS[build].alsoRuns) ranBuilds.add(implied);
    });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failures.set(build, failure);
    throw failure;
  }
}

/**
 * Every artifact the suite inspects, and the build that produces it.
 *
 * `build:panel` transitively runs the other three, so ordering matters only in
 * that it must come last — otherwise it would rewrite artifacts the earlier
 * builds just produced.
 */
const SUITE_ARTIFACTS: Array<{ artifact: string; build: string }> = [
  // `pnpm build` first, and never after: its `clean:dist` step wipes `dist/`,
  // including the two ExtendScript bundles and the assembled plugin. That is
  // the documented ordering in CLAUDE.md, and the reason the package tests pack
  // with `--ignore-scripts`.
  { artifact: "dist/index.js", build: "build" },
  { artifact: "dist/cli/index.js", build: "build" },
  { artifact: "dist/extendscript/all2html-core.js", build: "build:extendscript" },
  { artifact: "dist/extendscript/all2html-ae-core.js", build: "build:extendscript" },
  { artifact: "dist/all2html.js", build: "build:illustrator" },
  { artifact: "dist/after-effects/all2html-ae.jsx", build: "build:after-effects" },
  { artifact: "plugins/illustrator/panel/dist/cep/jsx/all2html.js", build: "build:panel" },
];

/**
 * Brings every suite artifact up to date. Called once from `globalSetup`,
 * before any worker exists, so no test ever reads an artifact another worker is
 * rewriting.
 */
export function buildArtifacts(): void {
  const needed: string[] = [];
  for (const { artifact, build } of SUITE_ARTIFACTS) {
    if (!isStale(resolve(repoRoot, artifact), build)) continue;
    if (needed.indexOf(build) === -1) needed.push(build);
  }
  // `build:panel` subsumes the bundle builds; running both would rebuild twice.
  // `build` is never subsumed and must lead, because it clears `dist/`.
  const bundles = needed.filter((name) => name !== "build");
  const collapsed = bundles.indexOf("build:panel") === -1 ? bundles : ["build:panel"];
  const order = needed.indexOf("build") === -1 ? collapsed : ["build", ...collapsed];
  for (const build of order) runBuild(build);
}

/**
 * Returns the absolute path to `relativePath`.
 *
 * Freshness is `globalSetup`'s job, and deliberately **not** re-checked here.
 * Two reasons. A worker that rebuilds can rewrite `dist/` while another worker
 * is reading it — the lock never covered that, because the read happens after
 * the lock is released, and the truncated read surfaces as a size-budget
 * failure that looks like a real finding. And re-deriving staleness per worker
 * is unreliable anyway: the builds touch paths that are themselves build
 * inputs, so an artifact can read as stale moments after being rebuilt.
 *
 * One evaluation, before any worker exists, is both correct and cheap. This
 * side only asserts the artifact is actually there.
 */
export function ensureFreshArtifact(relativePath: string, build: string): string {
  const full = resolve(repoRoot, relativePath);
  if (!BUILDS[build]) throw new Error(`Unknown build script: ${build}`);
  if (verified.has(full)) return full;

  if (!existsSync(full)) {
    throw new Error(
      `${relativePath} does not exist. Tests do not build on demand; globalSetup ` +
        `(test/global-setup.ts) builds every artifact first. Add it to SUITE_ARTIFACTS ` +
        `in test/helpers/extendscript-build.ts if it is missing from that list.`,
    );
  }

  verified.add(full);
  return full;
}
