/**
 * A consumer installing the published package runs its install-time lifecycle
 * scripts. `files` publishes only `dist/`, so a script referencing anything
 * outside that list is a MODULE_NOT_FOUND at install time for every consumer —
 * which is exactly what a `preinstall` pointing at `scripts/` did: the guard
 * was invisible in the repo (where the file exists) and fatal in the tarball.
 *
 * Two properties are asserted here, both cheap and offline:
 *   1. no install-time script references a path outside the packed file list;
 *   2. the pnpm-only guard cannot fire for a consumer, because it is gated on
 *      INIT_CWD === cwd, which only holds when installing this repo itself.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = resolve(import.meta.dirname, "../..");

/** Lifecycle scripts npm runs in a consumer's node_modules. */
const INSTALL_TIME_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];

type PackedFile = { path: string };

function packedFilePaths(): string[] {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const parsed = JSON.parse(raw) as Array<{ files?: PackedFile[] }>;
  return (parsed[0]?.files ?? []).map((file) => file.path);
}

describe("published package", () => {
  const manifest = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  // `npm pack --dry-run` walks the whole tree; it runs well past vitest's 5s default.
  it("runs no install-time script that references an unpacked file", { timeout: 60_000 }, () => {
    const packed = new Set(packedFilePaths());
    expect(packed.size).toBeGreaterThan(0); // the pack probe still works

    for (const name of INSTALL_TIME_SCRIPTS) {
      const script = manifest.scripts[name];
      if (!script) continue;

      // Any repo-relative path the script hands to node. Inline `node -e`
      // programs reference nothing on disk and are the safe form.
      for (const match of script.matchAll(/(?:^|\s)((?:\.\/)?(?:scripts|src|bin)\/[\w./-]+)/g)) {
        const referenced = match[1].replace(/^\.\//, "");
        expect(
          packed.has(referenced),
          `package.json "${name}" runs ${referenced}, which is not in the published files list. ` +
            `A consumer install would fail with MODULE_NOT_FOUND. Inline the logic with node -e, ` +
            `or move the script to a lifecycle that does not run for consumers.`,
        ).toBe(true);
      }
    }
  });

  it("cannot reject a consumer's package manager", () => {
    const preinstall = manifest.scripts.preinstall;
    if (!preinstall) return;

    // The guard is for this repo only. Without the INIT_CWD gate it would fail
    // every `npm install all2html` — the package manager a consumer uses is
    // none of our business.
    expect(
      preinstall.includes("INIT_CWD"),
      "preinstall must be gated on INIT_CWD === cwd so it only fires when installing this repo",
    ).toBe(true);

    // Prove it, rather than trusting the string: run the real script body with
    // a consumer-shaped environment and assert it exits 0.
    const body = preinstall
      .replace(/^node -e "/, "")
      .replace(/"$/, "")
      .replace(/\\"/g, '"');
    const asConsumer = execFileSync("node", ["-e", body], {
      cwd: rootDir,
      encoding: "utf8",
      env: { ...process.env, INIT_CWD: "/somewhere/else", npm_config_user_agent: "npm/10.0.0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(asConsumer).toBe("");
  });
});
