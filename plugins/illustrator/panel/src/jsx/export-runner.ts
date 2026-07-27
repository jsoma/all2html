type ScriptFileLike = {
  exists: boolean;
  fsName?: string;
  fullName?: string;
  encoding?: string;
  open: (mode: string) => boolean | void;
  write: (contents: string) => void;
  close: () => void;
  remove: () => boolean | void;
};

interface ExportRunnerEnv {
  globalState: Record<string, unknown>;
  createFile: (path: string) => ScriptFileLike;
  evalFile: (file: ScriptFileLike) => void;
  getCurrentScriptPath: () => string;
  getTempDirPath: () => string;
}

interface ExportRunnerOptions {
  settingsJson: string;
  fontsJson: string;
  scriptFileName: string;
  missingScriptError: string;
  failurePrefix: string;
  settingsPathGlobalKey?: string;
  settingsValueGlobalKey?: string;
  tempSettingsFileName?: string;
  fallbackScriptPaths?: Array<string | null | undefined>;
  onClearDiagnostics?: () => void;
  onLog?: (level: "info" | "warn" | "error", message: string, detail?: string) => void;
  attachDiagnostics?: (resultText: string, fallbackError: string) => string;
}

function buildNoResultError(): string {
  return JSON.stringify({ success: false, error: "No result returned" });
}

function createTempSettingsFile(
  env: ExportRunnerEnv,
  fileName: string,
  settingsJson: string,
): ScriptFileLike {
  var settingsFile = env.createFile(env.getTempDirPath() + "/" + fileName);
  settingsFile.open("w");
  settingsFile.encoding = "UTF-8";
  settingsFile.write(settingsJson);
  settingsFile.close();
  return settingsFile;
}

function resolveScriptFile(
  env: ExportRunnerEnv,
  scriptFileName: string,
  fallbackScriptPaths: Array<string | null | undefined> | undefined,
): {
  file: ScriptFileLike | null;
  expectedPath: string;
} {
  // RegExp constructor, not a literal: ExtendScript's tokenizer ends a regex
  // literal at the first unescaped `/` even inside a character class, so
  // /[^/\\]+$/ is a load-time SyntaxError that takes the whole hostscript
  // down with it. Guarded by extendscript-regex-safety.test.ts.
  var primaryPath = env.getCurrentScriptPath().replace(/[^/\\]+$/, scriptFileName);
  var scriptFile = env.createFile(primaryPath);

  if (scriptFile.exists) {
    return { file: scriptFile, expectedPath: primaryPath };
  }

  var fallbacks = fallbackScriptPaths || [];
  for (var i = 0; i < fallbacks.length; i += 1) {
    var fallbackPath = fallbacks[i];
    if (!fallbackPath) continue;
    scriptFile = env.createFile(String(fallbackPath));
    if (scriptFile.exists) {
      return { file: scriptFile, expectedPath: primaryPath };
    }
  }

  return { file: null, expectedPath: primaryPath };
}

function runPanelExport(env: ExportRunnerEnv, options: ExportRunnerOptions): string {
  var settingsFile = null as ScriptFileLike | null;
  var attachResultDiagnostics =
    options.attachDiagnostics || ((resultText: string): string => resultText);
  var log = options.onLog || ((): void => {});

  try {
    options.onClearDiagnostics && options.onClearDiagnostics();
    log("info", "Starting panel export", options.scriptFileName);
    env.globalState.ALL2HTML_AUTOMATED = true;
    env.globalState.__ALL2HTML_PANEL_FONTS__ = options.fontsJson;

    if (options.settingsPathGlobalKey) {
      settingsFile = createTempSettingsFile(
        env,
        options.tempSettingsFileName || "all2html-panel-settings.json",
        options.settingsJson,
      );
      log(
        "info",
        "Wrote temporary panel settings",
        settingsFile.fsName || settingsFile.fullName || "",
      );
      env.globalState[options.settingsPathGlobalKey] =
        settingsFile.fsName || settingsFile.fullName || "";
    }

    if (options.settingsValueGlobalKey) {
      env.globalState[options.settingsValueGlobalKey] = options.settingsJson;
      log("info", "Attached inline panel settings", options.settingsValueGlobalKey);
    }

    var scriptFileResult = resolveScriptFile(
      env,
      options.scriptFileName,
      options.fallbackScriptPaths,
    );

    if (!scriptFileResult.file) {
      log("error", "Export script not found", scriptFileResult.expectedPath);
      return attachResultDiagnostics(
        JSON.stringify({
          success: false,
          error: options.missingScriptError + scriptFileResult.expectedPath,
        }),
        "Export script not found",
      );
    }

    log(
      "info",
      "Evaluating export script",
      scriptFileResult.file.fsName || scriptFileResult.expectedPath,
    );
    env.evalFile(scriptFileResult.file);

    var result = env.globalState.__ALL2HTML_RESULT__;
    if (!result) {
      log("error", "Exporter returned no result");
      return attachResultDiagnostics(buildNoResultError(), "No result returned");
    }

    return attachResultDiagnostics(String(result), "Export failed");
  } catch (e) {
    log("error", "Panel export execution failed", String(e));
    return attachResultDiagnostics(
      JSON.stringify({
        success: false,
        error: options.failurePrefix + String(e),
      }),
      options.failurePrefix + String(e),
    );
  } finally {
    try {
      if (settingsFile && settingsFile.exists) {
        settingsFile.remove();
        log(
          "info",
          "Removed temporary panel settings",
          settingsFile.fsName || settingsFile.fullName || "",
        );
      }
      if (options.settingsPathGlobalKey) {
        delete env.globalState[options.settingsPathGlobalKey];
      }
      if (options.settingsValueGlobalKey) {
        delete env.globalState[options.settingsValueGlobalKey];
      }
      delete env.globalState.__ALL2HTML_PANEL_FONTS__;
      delete env.globalState.__ALL2HTML_RESULT__;
      env.globalState.ALL2HTML_AUTOMATED = false;
    } catch (cleanupError) {
      // ignore cleanup errors
    }
  }
}

export type { ExportRunnerEnv, ExportRunnerOptions, ScriptFileLike };
export { runPanelExport };
