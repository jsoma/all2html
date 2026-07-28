import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfigFile } from "../../src/cli/config-file.js";
import { resolveSettings } from "../../src/core/resolve-settings.js";
import { loadAndValidateIR } from "../../src/ir/validate.js";

function withTempConfig(content: string, run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "all2html-config-"));
  const path = join(dir, "all2html.config.json");
  try {
    writeFileSync(path, content, "utf-8");
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Config file I/O moved from `resolveSettings` into the CLI (`readConfigFile`),
 * which reads the file once per run and passes the parsed object into the pure
 * resolver. These assertions moved with it.
 */
describe("readConfigFile validation (CLI)", () => {
  it("rejects malformed JSONC config files", () => {
    withTempConfig('{ "settings": { "maxWidth": 600, }', (configPath) => {
      expect(() => readConfigFile(configPath)).toThrow(/Invalid config file/);
    });
  });

  it("rejects invalid settings types in config files", () => {
    withTempConfig('{ "settings": { "maxWidth": "oops" } }', (configPath) => {
      expect(() => readConfigFile(configPath)).toThrow(/settings.maxWidth/);
    });
  });

  it("names the file when it cannot be read", () => {
    expect(() => readConfigFile("/nonexistent/all2html.config.json")).toThrow(
      /Failed to read config file "\/nonexistent\/all2html\.config\.json"/,
    );
  });
});

describe("resolveSettings is pure", () => {
  const doc = loadAndValidateIR(
    JSON.parse(readFileSync("test/fixtures/ir/single-artboard-basic.json", "utf-8")),
  );

  it("applies inline config settings over defaults, and document settings over both", () => {
    const resolved = resolveSettings(doc, { settings: { maxWidth: 720 } });
    expect(resolved.settings.maxWidth).toBe(720);

    const docWins = resolveSettings(
      { ...doc, settings: { ...doc.settings, maxWidth: 480 } },
      { settings: { maxWidth: 720 } },
    );
    expect(docWins.settings.maxWidth).toBe(480);
  });

  it("resolves with no config at all", () => {
    const resolved = resolveSettings(doc);
    expect(resolved.pipelinePhase).toBe("resolved");
  });
});
