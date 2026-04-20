import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEmitterConfig, resolveSettings } from "../../src/core/resolve-settings.js";
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

describe("resolveSettings config validation", () => {
  const doc = loadAndValidateIR(
    JSON.parse(readFileSync("test/fixtures/ir/single-artboard-basic.json", "utf-8")),
  );

  it("rejects malformed JSONC config files", () => {
    withTempConfig('{ "settings": { "maxWidth": 600, }', (configPath) => {
      expect(() => resolveSettings(doc, configPath)).toThrow(/Invalid config file/);
    });
  });

  it("rejects invalid settings types in config files", () => {
    withTempConfig('{ "settings": { "maxWidth": "oops" } }', (configPath) => {
      expect(() => resolveSettings(doc, configPath)).toThrow(/settings.maxWidth/);
    });
  });

  it("parses validated emitter config", () => {
    withTempConfig('{ "emit": { "html": { "positionMode": "percentage" } } }', (configPath) => {
      expect(parseEmitterConfig(configPath)).toEqual({
        html: { positionMode: "percentage" },
      });
    });
  });

  it("rejects invalid emitter config values", () => {
    withTempConfig('{ "emit": { "react": { "fitMode": "cover" } } }', (configPath) => {
      expect(() => parseEmitterConfig(configPath)).toThrow(/emit.react/);
    });
  });
});
