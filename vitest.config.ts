import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    exclude: ["test/visual/**"],
    // Builds every ExtendScript artifact before any worker starts. Tests used
    // to build on demand, which let one worker rewrite dist/ while another read
    // it — a truncated read reported as a size-budget failure.
    globalSetup: ["test/global-setup.ts"],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
