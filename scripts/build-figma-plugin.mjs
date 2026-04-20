import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const pluginDir = resolve(root, "plugins/figma");
const srcDir = resolve(pluginDir, "src");
const distDir = resolve(pluginDir, "dist");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const uiBundle = await build({
  entryPoints: [resolve(srcDir, "ui-entry.ts")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2017",
  supported: {
    "object-rest-spread": false,
  },
});

const uiTemplate = readFileSync(resolve(srcDir, "ui.html"), "utf8");
const uiHtml = uiTemplate.replace("/*__UI_BUNDLE__*/", () => uiBundle.outputFiles[0].text.trim());
writeFileSync(resolve(distDir, "ui.html"), uiHtml);

await build({
  entryPoints: [resolve(srcDir, "main.ts")],
  bundle: true,
  outfile: resolve(distDir, "main.js"),
  format: "iife",
  platform: "browser",
  target: "es2017",
  supported: {
    "object-rest-spread": false,
  },
  sourcemap: false,
  define: {
    __UI_HTML__: JSON.stringify(uiHtml),
  },
});

console.log(`Built Figma plugin to ${distDir}`);
