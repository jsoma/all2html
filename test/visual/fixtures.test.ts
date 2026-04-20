import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureOutputDir = resolve(__dirname, "fixture-output");

const htmlFiles = readdirSync(fixtureOutputDir)
  .filter((f) => f.endsWith(".html"))
  .sort();

for (const file of htmlFiles) {
  const name = file.replace(".html", "");

  test(`${name} renders without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`file://${join(fixtureOutputDir, file)}`);
    await page.waitForTimeout(300);

    expect(errors).toHaveLength(0);

    const container = await page.locator(".ai2html").count();
    expect(container).toBeGreaterThan(0);
  });

  test(`${name} screenshot`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`file://${join(fixtureOutputDir, file)}`);
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot(`fixture-${name}.png`, {
      fullPage: true,
      threshold: 0.05,
    });
  });
}
