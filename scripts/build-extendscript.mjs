import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { rollup } from "rollup";

const root = process.cwd();
const tempDir = resolve(root, ".tmp/extendscript");

/**
 * Two ExtendScript bundles come out of one `tsc` pass.
 *
 * `all2html-core.js` is the IR pipeline the Illustrator exporter calls.
 * `all2html-ae-core.js` is the helper-only bundle for After Effects, which does
 * not construct IR (D13) and so must not pay for the pipeline. Both install the
 * ES5 polyfills at load; see `src/extendscript/ae-index.ts` for why the second
 * entry exists rather than After Effects importing the first.
 */
const BUNDLES = [
  { entry: "extendscript/index.js", out: "dist/extendscript/all2html-core.js", name: "All2Html" },
  {
    entry: "extendscript/ae-index.js",
    out: "dist/extendscript/all2html-ae-core.js",
    name: "All2HtmlAE",
  },
];

rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });

execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.extendscript.json", "--outDir", tempDir], {
  cwd: root,
  stdio: "inherit",
});

for (const target of BUNDLES) {
  const outputFile = resolve(root, target.out);
  const bundle = await rollup({
    input: resolve(tempDir, target.entry),
    context: "this",
  });

  await bundle.write({
    file: outputFile,
    format: "iife",
    name: target.name,
    esModule: false,
  });

  await bundle.close();
  console.log(`Built ${target.out} (${statSync(outputFile).size} bytes)`);
}

rmSync(tempDir, { recursive: true, force: true });
