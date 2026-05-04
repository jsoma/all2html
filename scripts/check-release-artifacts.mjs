import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";

const root = process.argv[2] || ".";

function fail(message) {
  console.error(`Release artifact check failed: ${message}`);
  process.exitCode = 1;
}

function assertFile(path) {
  if (!existsSync(path)) {
    fail(`missing ${path}`);
    return false;
  }
  if (statSync(path).size === 0) {
    fail(`empty ${path}`);
    return false;
  }
  return true;
}

function findFirstFile(dir, extension) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFirstFile(path, extension);
      if (found) return found;
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      return path;
    }
  }
  return null;
}

function assertFigmaZip(path) {
  if (!assertFile(path)) return;
  const entries = unzipSync(new Uint8Array(readFileSync(path)));
  if (!entries["manifest.json"]) {
    fail(`${path} does not contain manifest.json`);
  }
  if (!Object.keys(entries).some((entry) => entry.startsWith("dist/"))) {
    fail(`${path} does not contain built dist files`);
  }
}

const releaseAssetMode = process.argv[2] !== undefined;

if (releaseAssetMode) {
  assertFile(join(root, "all2html.js"));
  assertFile(join(root, "all2html-after-effects.zip"));
  assertFigmaZip(join(root, "all2html-figma-plugin.zip"));
  assertFile(join(root, "all2html-panel.zip"));
  assertFile(join(root, "all2html-panel.zxp"));
} else {
  assertFile("dist/all2html.js");
  assertFile("dist/all2html-after-effects.zip");
  assertFigmaZip("dist/all2html-figma-plugin.zip");

  const panelZip = findFirstFile("plugins/illustrator/panel/dist/zip", ".zip");
  const panelZxp = findFirstFile("plugins/illustrator/panel/dist/zxp", ".zxp");
  if (!panelZip) fail("missing panel zip under plugins/illustrator/panel/dist/zip");
  else assertFile(panelZip);
  if (!panelZxp) fail("missing panel zxp under plugins/illustrator/panel/dist/zxp");
  else assertFile(panelZxp);
}

if (!process.exitCode) {
  console.log("Release artifacts verified.");
}
