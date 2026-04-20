import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getIllustratorFixtureGoldenIrPath,
  getIllustratorFixtureManualQaDocPath,
  getIllustratorFixtureOutputDir,
  getIllustratorFixtureVisualBaselinePaths,
  illustratorFixtures,
} from "../test/fixtures/illustrator-fixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

interface FixtureIssue {
  fixture: string;
  issue: string;
}

function outputDirLooksComplete(path: string): boolean {
  if (!existsSync(path)) return false;
  const files = readdirSync(path);
  return files.includes("ir.json") && files.some((file) => file.endsWith(".html"));
}

function collectIssues(): FixtureIssue[] {
  const issues: FixtureIssue[] = [];
  const manualQaPath = getIllustratorFixtureManualQaDocPath(rootDir);
  const manualQaContent = existsSync(manualQaPath) ? readFileSync(manualQaPath, "utf-8") : "";

  for (const fixture of illustratorFixtures) {
    const sourcePath = resolve(rootDir, fixture.sourceAiPath);
    if (!existsSync(sourcePath)) {
      issues.push({ fixture: fixture.name, issue: `missing source AI: ${fixture.sourceAiPath}` });
    }

    if (
      fixture.requiredArtifacts.savedOutput &&
      !outputDirLooksComplete(getIllustratorFixtureOutputDir(rootDir, fixture))
    ) {
      issues.push({
        fixture: fixture.name,
        issue: "missing saved output directory with ir.json + html",
      });
    }

    if (
      fixture.requiredArtifacts.goldenIr &&
      !existsSync(getIllustratorFixtureGoldenIrPath(rootDir, fixture))
    ) {
      issues.push({ fixture: fixture.name, issue: "missing golden IR fixture" });
    }

    if (fixture.requiredArtifacts.visualBaseline) {
      for (const path of getIllustratorFixtureVisualBaselinePaths(rootDir, fixture)) {
        if (!existsSync(path)) {
          issues.push({
            fixture: fixture.name,
            issue: `missing visual baseline: ${path.replace(`${rootDir}/`, "")}`,
          });
        }
      }
    }

    if (fixture.requiredArtifacts.manualQa && !manualQaContent.includes(fixture.name)) {
      issues.push({
        fixture: fixture.name,
        issue: "manual QA checklist does not mention this fixture",
      });
    }
  }

  return issues;
}

const issues = collectIssues();

if (issues.length === 0) {
  console.log(`Illustrator fixture audit passed (${illustratorFixtures.length} fixtures checked).`);
  process.exit(0);
}

console.error("Illustrator fixture audit failed:");
for (const issue of issues) {
  console.error(`- ${issue.fixture}: ${issue.issue}`);
}
process.exit(1);
