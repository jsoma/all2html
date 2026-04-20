import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const siteDir = resolve(root, "site");
const svgDropzoneDistDir = resolve(root, "apps", "svg-dropzone", "dist");
const svgDropzoneSiteDir = resolve(siteDir, "svg-converter");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

rmSync(siteDir, { recursive: true, force: true });

run("uvx", ["--from", "zensical", "zensical", "build"]);
run("pnpm", ["build:svg-dropzone"]);

mkdirSync(svgDropzoneSiteDir, { recursive: true });
cpSync(svgDropzoneDistDir, svgDropzoneSiteDir, { recursive: true });
writeFileSync(resolve(siteDir, ".nojekyll"), "");

