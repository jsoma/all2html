#!/usr/bin/env node
// Verifies that every path package.json advertises actually exists after `pnpm build`.
//
// This exists because `main`, `types`, and `bin` once pointed at `dist/index.js` while
// tsc emitted to `dist/src/index.js` — `npx all2html` would have failed with ENOENT.
// The gap survived because `pnpm build` ran in no CI workflow.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));

/** @type {Array<{label: string, path: string}>} */
const entries = [];

if (pkg.main) entries.push({ label: "main", path: pkg.main });
if (pkg.types) entries.push({ label: "types", path: pkg.types });

for (const [name, target] of Object.entries(pkg.bin ?? {})) {
  entries.push({ label: `bin.${name}`, path: target });
}

for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
  if (typeof target === "string") {
    entries.push({ label: `exports["${subpath}"]`, path: target });
    continue;
  }
  for (const [condition, conditionTarget] of Object.entries(target)) {
    if (typeof conditionTarget === "string") {
      entries.push({ label: `exports["${subpath}"].${condition}`, path: conditionTarget });
    }
  }
}

const missing = entries.filter((entry) => !existsSync(resolve(rootDir, entry.path)));

for (const entry of entries) {
  const status = missing.includes(entry) ? "MISSING" : "ok";
  console.log(`${status.padEnd(7)} ${entry.label} -> ${entry.path}`);
}

if (missing.length > 0) {
  console.error(
    `\n${missing.length} declared entry point(s) do not exist after build. ` +
      `Run \`pnpm build\` and check tsconfig.build.json rootDir/outDir.`,
  );
  process.exit(1);
}

// The bin entry must be directly executable by node, which requires a shebang.
for (const target of Object.values(pkg.bin ?? {})) {
  const contents = readFileSync(resolve(rootDir, target), "utf8");
  if (!contents.startsWith("#!")) {
    console.error(`\nbin entry ${target} is missing a shebang line.`);
    process.exit(1);
  }
}

console.log(`\nAll ${entries.length} declared entry points resolve.`);
