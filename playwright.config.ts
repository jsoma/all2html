import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/visual",
  timeout: 30000,
  use: {
    browserName: "chromium",
    viewport: { width: 1200, height: 800 },
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
});
