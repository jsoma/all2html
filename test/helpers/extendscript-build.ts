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
  "build:extendscript": { inputs: CORE_INPUTS, alsoRuns: [] },
  "build:illustrator": { inputs: ILLUSTRATOR_INPUTS, alsoRuns: ["build:extendscript"] },
  "build:panel": {
    inputs: PANEL_INPUTS,
    alsoRuns: ["build:extendscript", "build:illustrator"],
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

/** Cross-process mutex so parallel vitest workers do not build the same target. */
function withBuildLock<T>(name: string, fn: () => T): T {
  const lockDir = resolve(repoRoot, ".tmp/test-builds", `${name.replace(/[^\w.-]/g, "-")}.lock`);
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

/**
 * Returns the absolute path to `relativePath`, running `build` first when the
 * artifact is missing or older than the build's inputs.
 */
export function ensureFreshArtifact(relativePath: string, build: string): string {
  const full = resolve(repoRoot, relativePath);
  if (!BUILDS[build]) throw new Error(`Unknown build script: ${build}`);
  if (verified.has(full)) return full;
  const previousFailure = failures.get(build);
  if (previousFailure) throw previousFailure;

  try {
    withBuildLock(build, () => {
      // Re-checked under the lock: another worker may have just built this, and
      // holding the lock also keeps us from reading a half-written artifact.
      if (!isStale(full, build)) return;
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

  verified.add(full);
  return full;
}
