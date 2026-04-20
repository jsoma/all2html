import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

type HostTarget = "illustrator" | "after-effects";

function buildDiagnosticProbe(
  hostscriptPath: string,
  outputPath: string,
  clearAfterRead: boolean,
): string {
  return `
function writeDiagnosticsOutput(text) {
  var file = new File("${outputPath.replace(/\\/g, "\\\\")}");
  file.encoding = "UTF-8";
  file.open("w");
  file.write(String(text || ""));
  file.close();
}

var ns = $["com.all2html.panel"];
try {
  if (!ns || !ns.getDiagnostics) {
    $.evalFile("${hostscriptPath.replace(/\\/g, "\\\\")}");
    ns = $["com.all2html.panel"];
  }
  if (!ns || !ns.getDiagnostics) {
    writeDiagnosticsOutput(JSON.stringify({ entries: [], lastError: "Host diagnostics command is unavailable." }));
  } else {
    var result = ns.getDiagnostics();
    ${clearAfterRead ? 'if (ns.clearDiagnostics) ns.clearDiagnostics();' : ""}
    writeDiagnosticsOutput(result);
  }
} catch (e) {
  writeDiagnosticsOutput(JSON.stringify({
    entries: [],
    lastError: String(e),
    bootstrapError: String(e)
  }));
}
`.trim();
}

function readDiagnostics(target: HostTarget, clearAfterRead: boolean): string {
  const hostscriptPath = resolve(
    "plugins/illustrator/panel/dist/cep/jsx/hostscript.js",
  );

  const tmpDir = mkdtempSync(join(tmpdir(), "all2html-cep-diagnostics-"));
  const scriptPath = join(tmpDir, "probe.jsx");
  const outputPath = join(tmpDir, "diagnostics.json");
  writeFileSync(
    scriptPath,
    buildDiagnosticProbe(hostscriptPath, outputPath, clearAfterRead),
    "utf8",
  );

  try {
    const appName =
      target === "illustrator"
        ? "Adobe Illustrator"
        : "Adobe After Effects 2026";

    const appleScript =
      target === "illustrator"
        ? [
            "-e",
            `tell application "${appName}"
              do javascript (read POSIX file "${scriptPath}")
            end tell`,
          ]
        : [
            "-e",
            `tell application "${appName}"
              DoScript (read POSIX file "${scriptPath}")
            end tell`,
          ];

    execFileSync("osascript", appleScript, {
      encoding: "utf8",
    }).trim();
    return readFileSync(outputPath, "utf8").trim();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

const targetArg = String(process.argv[2] || "").trim();
const clearAfterRead = process.argv.includes("--clear");

if (targetArg !== "illustrator" && targetArg !== "after-effects") {
  console.error("Usage: pnpm exec tsx scripts/read-cep-diagnostics.ts <illustrator|after-effects> [--clear]");
  process.exit(1);
}

const raw = readDiagnostics(targetArg, clearAfterRead);

try {
  const parsed = JSON.parse(raw);
  console.log(JSON.stringify(parsed, null, 2));
} catch {
  console.log(raw);
}
