import { describe, expect, it, vi } from "vitest";
import {
  type ExportRunnerEnv,
  runPanelExport,
  type ScriptFileLike,
} from "../../plugins/illustrator/panel/src/jsx/export-runner.js";

type MockFile = ScriptFileLike & {
  path: string;
  open: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

function createMockFile(path: string, exists: boolean): MockFile {
  const file = {
    path,
    exists,
    fsName: path,
    fullName: path,
    open: vi.fn(function (this: MockFile) {
      this.exists = true;
      return true;
    }),
    write: vi.fn(function (this: MockFile) {
      this.exists = true;
    }),
    close: vi.fn(),
    remove: vi.fn(function (this: MockFile) {
      this.exists = false;
      return true;
    }),
  };

  return file;
}

function createRunnerEnv(existingPaths: string[]): ExportRunnerEnv & {
  files: Map<string, MockFile>;
} {
  const files = new Map<string, MockFile>();

  return {
    files,
    globalState: {},
    createFile(path: string) {
      if (!files.has(path)) {
        files.set(path, createMockFile(path, existingPaths.includes(path)));
      }
      const file = files.get(path);
      if (!file) {
        throw new Error(`Missing mock file: ${path}`);
      }
      return file;
    },
    evalFile: vi.fn(),
    getCurrentScriptPath: () => "/extension/jsx/hostscript.js",
    getTempDirPath: () => "/tmp",
  };
}

describe("shared host export runner", () => {
  it("supports the Illustrator temp-settings path and document fallback script lookup", () => {
    const env = createRunnerEnv(["/doc/all2html.js"]);
    env.evalFile = vi.fn((file: ScriptFileLike) => {
      env.globalState.__ALL2HTML_RESULT__ = JSON.stringify({
        success: true,
        scriptPath: file.fsName,
        settingsPath: env.globalState.__ALL2HTML_PANEL_SETTINGS_PATH__,
        fonts: env.globalState.__ALL2HTML_PANEL_FONTS__,
      });
    });

    const raw = runPanelExport(env, {
      settingsJson: '{"output":"multiple-files"}',
      fontsJson: '["ArialMT"]',
      scriptFileName: "all2html.js",
      missingScriptError: "Cannot find all2html.js. Expected at: ",
      failurePrefix: "Export failed: ",
      settingsPathGlobalKey: "__ALL2HTML_PANEL_SETTINGS_PATH__",
      tempSettingsFileName: "all2html-panel-settings.json",
      fallbackScriptPaths: ["/doc/all2html.js"],
    });

    expect(JSON.parse(raw)).toEqual({
      success: true,
      scriptPath: "/doc/all2html.js",
      settingsPath: "/tmp/all2html-panel-settings.json",
      fonts: '["ArialMT"]',
    });

    const settingsFile = env.files.get("/tmp/all2html-panel-settings.json");
    expect(settingsFile?.write).toHaveBeenCalledWith('{"output":"multiple-files"}');
    expect(settingsFile?.remove).toHaveBeenCalled();
    expect(env.globalState.__ALL2HTML_PANEL_SETTINGS_PATH__).toBeUndefined();
    expect(env.globalState.__ALL2HTML_PANEL_FONTS__).toBeUndefined();
    expect(env.globalState.ALL2HTML_AUTOMATED).toBe(false);
  });

  it("supports the AE inline-settings path without creating a temp settings file", () => {
    const env = createRunnerEnv(["/extension/jsx/all2html-ae.jsx"]);
    env.evalFile = vi.fn(() => {
      env.globalState.__ALL2HTML_RESULT__ = JSON.stringify({
        success: true,
        settings: env.globalState.__ALL2HTML_AE_PANEL_SETTINGS__,
      });
    });

    const raw = runPanelExport(env, {
      settingsJson: '{"overlayPrefix":"overlay:"}',
      fontsJson: "[]",
      scriptFileName: "all2html-ae.jsx",
      missingScriptError: "Cannot find all2html-ae.jsx. Expected at: ",
      failurePrefix: "AE export failed: ",
      settingsValueGlobalKey: "__ALL2HTML_AE_PANEL_SETTINGS__",
    });

    expect(JSON.parse(raw)).toEqual({
      success: true,
      settings: '{"overlayPrefix":"overlay:"}',
    });
    expect(env.files.has("/tmp/all2html-panel-settings.json")).toBe(false);
    expect(env.globalState.__ALL2HTML_AE_PANEL_SETTINGS__).toBeUndefined();
  });

  it("cleans up globals and temp files when the exporter throws", () => {
    const env = createRunnerEnv(["/extension/jsx/all2html.js"]);
    env.evalFile = vi.fn(() => {
      throw new Error("boom");
    });

    const raw = runPanelExport(env, {
      settingsJson: "{}",
      fontsJson: "[]",
      scriptFileName: "all2html.js",
      missingScriptError: "Cannot find all2html.js. Expected at: ",
      failurePrefix: "Export failed: ",
      settingsPathGlobalKey: "__ALL2HTML_PANEL_SETTINGS_PATH__",
    });

    expect(JSON.parse(raw)).toEqual({
      success: false,
      error: "Export failed: Error: boom",
    });
    expect(env.files.get("/tmp/all2html-panel-settings.json")?.remove).toHaveBeenCalled();
    expect(env.globalState.__ALL2HTML_PANEL_SETTINGS_PATH__).toBeUndefined();
    expect(env.globalState.__ALL2HTML_PANEL_FONTS__).toBeUndefined();
    expect(env.globalState.ALL2HTML_AUTOMATED).toBe(false);
  });

  it("returns a structured error when the export script cannot be found", () => {
    const env = createRunnerEnv([]);

    const raw = runPanelExport(env, {
      settingsJson: "{}",
      fontsJson: "[]",
      scriptFileName: "all2html-ae.jsx",
      missingScriptError: "Cannot find all2html-ae.jsx. Expected at: ",
      failurePrefix: "AE export failed: ",
      settingsValueGlobalKey: "__ALL2HTML_AE_PANEL_SETTINGS__",
    });

    expect(JSON.parse(raw)).toEqual({
      success: false,
      error: "Cannot find all2html-ae.jsx. Expected at: /extension/jsx/all2html-ae.jsx",
    });
  });
});
