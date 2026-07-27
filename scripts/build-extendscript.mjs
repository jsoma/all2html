import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { rollup } from "rollup";

const root = process.cwd();
const tempDir = resolve(root, ".tmp/extendscript");
const outputFile = resolve(root, "dist/extendscript/all2html-core.js");

rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });

execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.extendscript.json", "--outDir", tempDir], {
  cwd: root,
  stdio: "inherit",
});

const bundle = await rollup({
  input: resolve(tempDir, "extendscript/index.js"),
  context: "this",
});

await bundle.write({
  file: outputFile,
  format: "iife",
  name: "All2Html",
  esModule: false,
});

await bundle.close();
rmSync(tempDir, { recursive: true, force: true });
