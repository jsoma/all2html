import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { illustratorFixtures } from "../fixtures/illustrator-fixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, "../../data/all2html-output");
const widths = [320, 768, 1024, 1440];

const testDirs = illustratorFixtures
  .filter((fixture) => fixture.requiredArtifacts.visualBaseline)
  .map((fixture) => fixture.name)
  .filter((name) => {
    if (!existsSync(join(outputDir, name))) return false;
    const htmlFiles = readdirSync(join(outputDir, name)).filter((f) => f.endsWith(".html"));
    return htmlFiles.length > 0;
  });

for (const dirName of testDirs) {
  test.describe(dirName, () => {
    const dirPath = join(outputDir, dirName);
    const htmlFiles = readdirSync(dirPath).filter((f) => f.endsWith(".html"));
    const htmlFile = htmlFiles[0];

    test("renders without errors", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });

      await page.goto(`file://${join(dirPath, htmlFile)}`);
      await page.waitForTimeout(500);

      // No JS errors
      expect(errors).toHaveLength(0);

      // Page has content
      const body = await page.locator("body").innerHTML();
      expect(body.length).toBeGreaterThan(100);

      // Has our container
      const container = await page.locator(".ai2html").count();
      expect(container).toBeGreaterThan(0);
    });

    test("has visible text", async ({ page }) => {
      await page.goto(`file://${join(dirPath, htmlFile)}`);
      await page.waitForTimeout(500);

      // Text elements should be present and visible
      const textElements = await page.locator(".ai2html p").allTextContents();
      expect(textElements.length).toBeGreaterThan(0);
      expect(textElements.some((t) => t.trim().length > 0)).toBe(true);
    });

    for (const width of widths) {
      test(`screenshot at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`file://${join(dirPath, htmlFile)}`);
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot(`${dirName}-${width}.png`, {
          fullPage: true,
          threshold: 0.05,
        });
      });
    }
  });
}
