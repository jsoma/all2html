import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    fs: {
      allow: [resolve(__dirname, "../..")],
    },
  },
});
