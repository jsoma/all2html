/**
 * ExtendScript Rollup build helpers.
 * Compiles src/jsx/ to an ExtendScript-friendly bundle string.
 */

import { rollup, type RollupOptions, type OutputOptions } from "rollup";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import { babel } from "@rollup/plugin-babel";
import replace from "@rollup/plugin-replace";
import type { CEP_Config } from "vite-cep-plugin";
import { readFileSync } from "fs";
import path from "path";

export async function buildExtendScriptBundle(
  entry: string,
  cepConfig: CEP_Config,
  extensions: string[],
  isProduction: boolean,
): Promise<string> {
  const inputOptions: RollupOptions = {
    input: entry,
    plugins: [
      json(),
      resolve({ extensions }),
      commonjs(),
      replace({
        preventAssignment: true,
        values: {
          "process.env.NODE_ENV": JSON.stringify(
            isProduction ? "production" : "development",
          ),
          __CEP_ID__: JSON.stringify(cepConfig.id),
        },
      }),
      babel({
        babelHelpers: "runtime",
        extensions,
        presets: [
          ["@babel/preset-env", { targets: { ie: "11" } }],
          "@babel/preset-typescript",
        ],
        plugins: [
          "@babel/plugin-proposal-class-properties",
          "@babel/plugin-proposal-object-rest-spread",
          "@babel/plugin-transform-runtime",
        ],
      }),
    ],
  };

  // Prepend JSON2 polyfill — ExtendScript has no built-in JSON object
  const json2Polyfill = readFileSync(
    path.resolve(path.dirname(entry), "lib", "json2.js"),
    "utf-8",
  );

  const outputOptions: OutputOptions = {
    format: "iife",
    name: "hostscript",
    generatedCode: "es5",
    globals: {},
    banner: `// JSON2 polyfill for ExtendScript\n${json2Polyfill}\n`,
  };

  const bundle = await rollup(inputOptions);
  try {
    const generated = await bundle.generate(outputOptions);
    const parts: string[] = [];
    for (const item of generated.output) {
      if (item.type === "chunk") {
        parts.push(item.code);
      } else {
        parts.push(String(item.source));
      }
    }
    return parts.join("\n");
  } finally {
    await bundle.close();
  }
}
