/**
 * What a consumer actually receives, asserted against the real tarball and the
 * real lifecycle scripts.
 *
 * Two failures motivated every check here, and both passed weaker versions of
 * this file:
 *
 *   1. `files` publishes only `dist/`, which is gitignored, and nothing built it
 *      at publish time — so `npm pack` from a clean checkout produced a tarball
 *      containing exactly `README.md` and `package.json`. Every declared
 *      entrypoint was absent. A test asserting the archive was *non-empty*
 *      passed on those two files, which is why this one asserts the entrypoints.
 *   2. `preinstall` was `node -e "…'Use `pnpm install`'…"`. npm runs scripts
 *      through a shell, so the backticks inside the surrounding double quotes
 *      were command substitution: the guard *ran pnpm install*. A test that
 *      extracted the JavaScript and handed it to node directly could never see
 *      that, because it bypassed the shell. This one runs the lifecycle command
 *      itself and watches for the side effect.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = resolve(import.meta.dirname, "../..");

const manifest = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8")) as {
  main?: string;
  module?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  files?: string[];
  scripts: Record<string, string>;
};

/** Lifecycle scripts npm runs inside a consumer's node_modules. */
const INSTALL_TIME_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];

/** Lifecycle scripts npm runs before building the tarball. */
const PREPUBLISH_SCRIPTS = ["prepack", "prepare"];

function packedFilePaths(): string[] {
  // `--ignore-scripts` is not a shortcut, it is required: `prepack` runs
  // `pnpm build`, whose first step is `clean:dist`. Letting it run here would
  // delete `dist/all2html.js` and the ExtendScript bundles out from under every
  // other test in the run — globalSetup builds those once and nothing rebuilds
  // them. The file list is unaffected, because globalSetup has already produced
  // the same `dist/` a real pack would. That `prepack` exists at all is
  // asserted separately, from the manifest.
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const jsonStart = raw.indexOf("[");
  expect(jsonStart, `npm pack emitted no JSON:\n${raw.slice(0, 500)}`).toBeGreaterThanOrEqual(0);
  const parsed = JSON.parse(raw.slice(jsonStart)) as Array<{ files?: Array<{ path: string }> }>;
  return (parsed[0]?.files ?? []).map((file) => file.path);
}

/** Every path the manifest promises a consumer can resolve. */
function declaredEntrypoints(): string[] {
  const found: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === "string" && value.startsWith(".")) {
      found.push(value.replace(/^\.\//, ""));
    }
  };
  add(manifest.main);
  add(manifest.module);
  add(manifest.types);
  for (const target of Object.values(manifest.bin ?? {})) add(target);
  const walkExports = (node: unknown): void => {
    if (typeof node === "string") {
      add(node);
      return;
    }
    if (node && typeof node === "object") {
      for (const value of Object.values(node)) walkExports(value);
    }
  };
  walkExports(manifest.exports);
  return [...new Set(found)];
}

describe("published package", () => {
  it("builds before packing, so a clean checkout publishes real code", () => {
    // dist/ is gitignored. Without a prepublish lifecycle the tarball carries
    // nothing but the two files git tracks at the root.
    const builds = PREPUBLISH_SCRIPTS.some((name) => manifest.scripts[name]?.includes("build"));
    expect(
      builds,
      `None of ${PREPUBLISH_SCRIPTS.join("/")} runs the build, but "files" publishes only ` +
        `gitignored build output. Packing a clean checkout would ship an empty package.`,
    ).toBe(true);
  });

  it("ships every entrypoint it declares", { timeout: 120_000 }, () => {
    const packed = new Set(packedFilePaths());
    const entrypoints = declaredEntrypoints();
    expect(entrypoints.length).toBeGreaterThan(0); // the manifest probe still works

    for (const entrypoint of entrypoints) {
      expect(
        packed.has(entrypoint),
        `package.json declares ${entrypoint}, but it is not in the tarball. A consumer ` +
          `importing this package would fail to resolve it.`,
      ).toBe(true);
    }
  });

  it("runs no install-time script that references an unpacked file", { timeout: 120_000 }, () => {
    const packed = new Set(packedFilePaths());

    for (const name of INSTALL_TIME_SCRIPTS) {
      const script = manifest.scripts[name];
      if (!script) continue;

      // Any repo-relative path the script hands to node. Inline `node -e`
      // programs reference nothing on disk and are the safe form.
      for (const match of script.matchAll(/(?:^|\s)((?:\.\/)?(?:scripts|src|bin)\/[\w./-]+)/g)) {
        const referenced = match[1].replace(/^\.\//, "");
        expect(
          packed.has(referenced),
          `package.json "${name}" runs ${referenced}, which is not in the published files ` +
            `list. A consumer install would fail with MODULE_NOT_FOUND.`,
        ).toBe(true);
      }
    }
  });

  it("cannot reject, or side-effect on, a consumer's install", () => {
    const preinstall = manifest.scripts.preinstall;
    if (!preinstall) return;

    expect(
      preinstall.includes("INIT_CWD"),
      "preinstall must be gated on INIT_CWD === cwd so it only fires when installing this repo",
    ).toBe(true);

    // Run the lifecycle command the way npm does — through a shell — with a
    // consumer-shaped environment, and with a decoy `pnpm` first on PATH. If the
    // script's text can reach the shell as a command (backtick substitution,
    // `$(…)`, a stray `&&`), the decoy runs and drops a sentinel.
    const sandbox = mkdtempSync(join(tmpdir(), "all2html-preinstall-"));
    const binDir = join(sandbox, "bin");
    mkdirSync(binDir);
    const sentinel = join(sandbox, "pnpm-was-invoked");
    const decoy = join(binDir, "pnpm");
    writeFileSync(decoy, `#!/bin/sh\necho invoked > "${sentinel}"\n`);
    chmodSync(decoy, 0o755);

    const output = execFileSync("sh", ["-c", preinstall], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        INIT_CWD: "/somewhere/else",
        npm_config_user_agent: "npm/10.0.0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(
      existsSync(sentinel),
      "preinstall executed pnpm through the shell. Backticks and $() inside the script " +
        "string are command substitution, evaluated before the guard's condition runs.",
    ).toBe(false);
    expect(output).toBe("");
  });
});
