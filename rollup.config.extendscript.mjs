import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/extendscript/index.ts",
  output: {
    file: "dist/extendscript/all2html-core.js",
    format: "iife",
    name: "All2Html",
    esModule: false,
  },
  plugins: [
    typescript({
      tsconfig: "./tsconfig.extendscript.json",
    }),
  ],
};
