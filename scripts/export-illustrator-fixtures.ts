import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getIllustratorFixtureGoldenIrPath,
  getIllustratorFixtureOutputDir,
  getIllustratorFixtureSummaryPath,
  type IllustratorFixture,
  illustratorFixtures,
} from "../test/fixtures/illustrator-fixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const bundlePath = resolve(rootDir, "dist/all2html.js");

if (!existsSync(bundlePath)) {
  throw new Error("dist/all2html.js not found. Run `pnpm build:illustrator` first.");
}

const args = process.argv.slice(2);
const refreshGolden = args.includes("--golden");
const requestedNames = args.filter((arg) => !arg.startsWith("--"));
const fixtures =
  requestedNames.length > 0
    ? illustratorFixtures.filter((fixture) => requestedNames.includes(fixture.name))
    : illustratorFixtures;

if (fixtures.length === 0) {
  throw new Error("No Illustrator fixtures selected.");
}

function candidateOutputDirs(sourceDir: string): string[] {
  return readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(sourceDir, entry.name))
    .filter((dir) => dir.endsWith("all2html-output") || dir.endsWith("ai2html-output"));
}

function clearOutputDir(dir: string): void {
  const sharedCaptureRoot = resolve(rootDir, "data/all2html-output");
  if (dir === sharedCaptureRoot) {
    for (const entry of readdirSync(dir)) {
      const path = resolve(dir, entry);
      if (lstatSync(path).isDirectory()) continue;
      rmSync(path, { recursive: true, force: true });
    }
    return;
  }
  rmSync(dir, { recursive: true, force: true });
}

function copyFixtureOutput(sourceOutputDir: string, targetOutputDir: string): void {
  const sharedCaptureRoot = resolve(rootDir, "data/all2html-output");

  rmSync(targetOutputDir, { recursive: true, force: true });
  mkdirSync(targetOutputDir, { recursive: true });

  for (const entry of readdirSync(sourceOutputDir)) {
    const sourceEntry = resolve(sourceOutputDir, entry);
    if (sourceEntry === targetOutputDir) continue;

    // Shared capture root also holds tracked fixture directories.
    // Only copy the fresh export files for the current fixture, not sibling fixture folders.
    if (sourceOutputDir === sharedCaptureRoot && lstatSync(sourceEntry).isDirectory()) continue;

    cpSync(sourceEntry, resolve(targetOutputDir, entry), { recursive: true });
  }
}

function findProducedOutputDir(sourceDir: string): string | null {
  const candidates = candidateOutputDirs(sourceDir)
    .filter((dir) => existsSync(resolve(dir, "ir.json")))
    .sort(
      (a, b) => statSync(resolve(b, "ir.json")).mtimeMs - statSync(resolve(a, "ir.json")).mtimeMs,
    );
  return candidates[0] || null;
}

function runIllustratorExport(fixture: IllustratorFixture): void {
  const aiPath = resolve(rootDir, fixture.sourceAiPath).replace(/\\/g, "/");
  const sourceDir = dirname(aiPath);
  const exporterPath = bundlePath.replace(/\\/g, "/");

  for (const dir of candidateOutputDirs(sourceDir)) {
    clearOutputDir(dir);
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "all2html-export-"));
  const jsxPath = join(tmpDir, `${fixture.name}.jsx`);
  const summaryPath = join(tmpDir, `${fixture.name}-summary.json`).replace(/\\/g, "/");
  const jsx = `var previousInteraction = null;
try {
  previousInteraction = app.userInteractionLevel;
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
} catch (e) {}
try {
  var doc = app.open(new File("${aiPath}"));
  $.global.ALL2HTML_AUTOMATED = true;
  $.global.__ALL2HTML_PANEL_SETTINGS_PATH__ = undefined;
  $.global.__ALL2HTML_PANEL_FONTS__ = undefined;
  var exporter = new File("${exporterPath}");
  exporter.open("r");
  exporter.encoding = "UTF-8";
  var source = exporter.read();
  exporter.close();
  eval(source);
  if ($.global.__ALL2HTML_RESULT__) {
    var summaryFile = new File("${summaryPath}");
    summaryFile.encoding = "UTF-8";
    summaryFile.open("w");
    summaryFile.write(String($.global.__ALL2HTML_RESULT__));
    summaryFile.close();
  }
  doc.close(SaveOptions.DONOTSAVECHANGES);
} finally {
  if (previousInteraction !== null) {
    try {
      app.userInteractionLevel = previousInteraction;
    } catch (e) {}
  }
}`;

  writeFileSync(jsxPath, jsx, "utf-8");

  try {
    execFileSync(
      "osascript",
      [
        "-e",
        'tell application "Adobe Illustrator" to activate',
        "-e",
        `with timeout of 180 seconds
          tell application "Adobe Illustrator"
            do javascript (read POSIX file "${jsxPath}")
          end tell
        end timeout`,
      ],
      { encoding: "utf-8" },
    );

    const sourceOutputDir = findProducedOutputDir(sourceDir);
    if (!sourceOutputDir) {
      throw new Error(`No exporter output found for ${fixture.name} in ${sourceDir}`);
    }

    const targetOutputDir = getIllustratorFixtureOutputDir(rootDir, fixture);
    copyFixtureOutput(sourceOutputDir, targetOutputDir);

    if (existsSync(summaryPath)) {
      writeFileSync(
        getIllustratorFixtureSummaryPath(rootDir, fixture),
        `${readFileSync(summaryPath, "utf-8").trim()}\n`,
      );
    }

    if (refreshGolden && fixture.requiredArtifacts.goldenIr) {
      const sourceIrPath = resolve(sourceOutputDir, "ir.json");
      if (!existsSync(sourceIrPath)) {
        throw new Error(`Missing ir.json for ${fixture.name}`);
      }
      writeFileSync(
        getIllustratorFixtureGoldenIrPath(rootDir, fixture),
        readFileSync(sourceIrPath),
      );
    }

    clearOutputDir(sourceOutputDir);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

for (const fixture of fixtures) {
  console.log(`=== Exporting ${fixture.name} ===`);
  runIllustratorExport(fixture);
}
