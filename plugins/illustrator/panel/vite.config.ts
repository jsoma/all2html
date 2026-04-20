import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { cep, type CepOptions, runAction } from "vite-cep-plugin";
import cepConfig from "./cep.config";
import { buildExtendScriptBundle } from "./vite.es.config";
import path from "path";
import { existsSync, readFileSync } from "fs";

const src = path.resolve(__dirname, "src");
const root = path.resolve(src, "js");
const outDir = path.resolve(__dirname, "dist", "cep");
const illustratorBundlePath = path.resolve(__dirname, "..", "..", "..", "dist", "all2html.js");
const afterEffectsBundlePath = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "dist",
  "after-effects",
  "all2html-ae.jsx",
);

function includeHostBundles(): Plugin {
  let hostscriptSource = "";

  return {
    name: "include-host-bundles",
    apply: "build",
    async buildStart() {
      if (!existsSync(illustratorBundlePath)) {
        this.error(
          `Missing Illustrator bundle at ${illustratorBundlePath}. Run "pnpm build:illustrator" first.`,
        );
      }
      if (!existsSync(afterEffectsBundlePath)) {
        this.error(
          `Missing After Effects bundle at ${afterEffectsBundlePath}. Run "pnpm build:after-effects" first.`,
        );
      }
      hostscriptSource = await buildExtendScriptBundle(
        path.resolve(__dirname, "src/jsx/hostscript.ts"),
        cepConfig,
        [".js", ".ts"],
        isProduction,
      );
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "jsx/hostscript.js",
        source: hostscriptSource,
      });
      this.emitFile({
        type: "asset",
        fileName: "jsx/all2html.js",
        source: readFileSync(illustratorBundlePath, "utf-8"),
      });
      this.emitFile({
        type: "asset",
        fileName: "jsx/all2html-ae.jsx",
        source: readFileSync(afterEffectsBundlePath, "utf-8"),
      });
    },
  };
}

const input: Record<string, string> = {};
for (const panel of cepConfig.panels) {
  input[panel.name] = path.resolve(root, panel.mainPath);
}

const isProduction = process.env.NODE_ENV === "production";
const isPackage =
  process.env.ZXP_PACKAGE === "true" || process.env.ZIP_PACKAGE === "true";

const config: CepOptions = {
  cepConfig,
  isProduction,
  isPackage,
  isMetaPackage: process.env.ZIP_PACKAGE === "true",
  isServe: process.env.SERVE_PANEL === "true",
  debugReact: false,
  dir: `${__dirname}/dist`,
  cepDist: "cep",
  zxpOutput: `${__dirname}/dist/zxp/${cepConfig.id}`,
  zipOutput: `${__dirname}/dist/zip/${cepConfig.displayName}_${cepConfig.version}`,
  packages: cepConfig.installModules || [],
};

const action = process.env.BOLT_ACTION;
if (action) runAction(config, action);

export default defineConfig({
  plugins: [svelte(), includeHostBundles(), cep(config)],
  publicDir: path.resolve(__dirname, "public"),
  root,
  server: { port: cepConfig.port },
  preview: { port: cepConfig.servePort },
  build: {
    sourcemap: isPackage ? false : cepConfig.build?.sourceMap ?? true,
    emptyOutDir: true,
    rollupOptions: {
      input,
      output: {
        manualChunks: {},
        preserveModules: false,
        format: "cjs",
        entryFileNames: "assets/[name]-[hash].cjs",
        chunkFileNames: "assets/[name]-[hash].cjs",
      },
    },
    target: "chrome74",
    outDir,
  },
});
