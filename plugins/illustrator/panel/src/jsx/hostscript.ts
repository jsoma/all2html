/**
 * ExtendScript hostscript — API surface callable from the CEP panel via evalTS.
 *
 * All exported functions are registered on $["com.all2html.panel"] by the IIFE wrapper.
 * Arguments and return values are JSON strings (evalTS handles serialization).
 */

import {
  AE_HOST_COMMANDS,
  COMMON_HOST_COMMANDS,
  HOST_NAMESPACE,
  type HostCommandArgs,
  type HostCommandName,
  ILLUSTRATOR_HOST_COMMANDS,
} from "../shared/host-contract";
import {
  aeFindMissingFonts,
  aeGetProjectInfo,
  aeListComps,
  aeListOutputModuleTemplates,
  aeReadConfigFile,
  aeSaveConfigFile,
} from "./after-effects";
import {
  attachDiagnosticsToResult,
  clearDiagnostics,
  getDiagnosticsSnapshot,
  installExporterDiagnosticSink,
  logDiagnostic,
  uninstallExporterDiagnosticSink,
} from "./diagnostics";
import { runPanelExport } from "./export-runner";
import { collectDocumentFonts, findMissingFonts } from "./fonts";
import { XMP_DATA_KEY, xmpDeleteVariable, xmpGetVariable, xmpSetVariable } from "./xmp";

// ============================================================
// Namespace registration — bolt-cep convention
// ============================================================

($ as any)[HOST_NAMESPACE] = {};

function getHostGlobalState(): any {
  return $.global as any;
}

type SerializedHostCommandArgs<K extends HostCommandName> = {
  0: [];
  1: [string];
  2: [string, string];
}[HostCommandArgs<K>["length"]];

function registerHostCommand<K extends HostCommandName>(
  command: K,
  fn: (...args: SerializedHostCommandArgs<K>) => string,
): void {
  ($ as any)[HOST_NAMESPACE][command] = fn;
}

function unwrapBridgeStringArg(value: string): string {
  if (typeof value !== "string") {
    return String(value);
  }

  try {
    var parsed = JSON.parse(value);
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch (e) {
    // Keep the original string when the bridge passed a plain literal.
  }

  return value;
}

function isAfterEffectsHost(): boolean {
  try {
    return typeof app.name === "string" && /after effects/i.test(app.name);
  } catch (e) {
    return false;
  }
}

function stripJsonComments(content: string): string {
  var result = "";
  var inString = false;
  var inLineComment = false;
  var inBlockComment = false;
  var escapeNext = false;

  for (var i = 0; i < content.length; i += 1) {
    var ch = content.charAt(i);
    var next = content.charAt(i + 1);

    if (inLineComment) {
      if (ch === "\n" || ch === "\r") {
        inLineComment = false;
        result += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      result += ch;
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    result += ch;
  }

  return result;
}

// ============================================================
// Document operations
// ============================================================

/**
 * Get info about the active document. Returns JSON or "null".
 */
function hashString(value: string): string {
  var hash = 5381;
  for (var i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return value.length + ":" + (hash >>> 0).toString(16);
}

function getSettingsBlockSignature(): string | null {
  try {
    var tf = findSettingsBlock();
    if (!tf) {
      return null;
    }
    return hashString(tf.contents || "");
  } catch (e) {
    return null;
  }
}

function readActiveDocumentInfo(): {
  name: string;
  path: string;
  saved: boolean;
  artboardCount: number;
  settingsBlockSignature: string | null;
} | null {
  try {
    var doc = app.activeDocument;
    var path = "";

    try {
      path = doc.path.fsName;
    } catch (pathError) {
      path = "";
    }

    return {
      name: doc.name,
      path: path,
      saved: doc.saved,
      artboardCount: doc.artboards.length,
      settingsBlockSignature: getSettingsBlockSignature(),
    };
  } catch (e) {
    return null;
  }
}

registerHostCommand(ILLUSTRATOR_HOST_COMMANDS.getDocumentInfo, (): string => {
  var info = readActiveDocumentInfo();
  if (!info) {
    return "null";
  }
  return JSON.stringify(info);
});

registerHostCommand(AE_HOST_COMMANDS.getAeProjectInfo, (): string => {
  try {
    return JSON.stringify(aeGetProjectInfo());
  } catch (e) {
    return "null";
  }
});

registerHostCommand(AE_HOST_COMMANDS.listAeComps, (): string => {
  try {
    return JSON.stringify(aeListComps());
  } catch (e) {
    return "[]";
  }
});

registerHostCommand(AE_HOST_COMMANDS.getAeOutputTemplates, (compId: string): string => {
  try {
    return JSON.stringify(aeListOutputModuleTemplates(unwrapBridgeStringArg(compId) || null));
  } catch (e) {
    return JSON.stringify({ outputModuleTemplates: [], canQueueInAME: false });
  }
});

/**
 * Get the document directory path.
 */
registerHostCommand(ILLUSTRATOR_HOST_COMMANDS.getDocumentPath, (): string => {
  try {
    return app.activeDocument.path.fsName;
  } catch (e) {
    return "";
  }
});

/**
 * Open a folder in the OS file browser.
 */
registerHostCommand(COMMON_HOST_COMMANDS.openFolder, (folderPath: string): string => {
  try {
    var normalizedPath = unwrapBridgeStringArg(folderPath);
    var folder = new Folder(normalizedPath);
    // Resolve "~" and aliases before checking existence. ExtendScript can leave
    // shorthand paths unresolved if we check the raw Folder first.
    var resolvedPath = folder.fsName || folder.fullName || folderPath;
    var resolvedFolder = new Folder(resolvedPath);
    if (!resolvedFolder.exists && folder.exists) {
      resolvedFolder = folder;
    }

    if (resolvedFolder.exists) {
      if (isAfterEffectsHost()) {
        return JSON.stringify({
          success: false,
          error: "Open folder fallback is unsupported in After Effects host scripting",
          path: resolvedFolder.fsName || resolvedFolder.fullName,
        });
      }

      if (resolvedFolder.execute()) {
        return JSON.stringify({
          success: true,
          path: resolvedFolder.fsName || resolvedFolder.fullName,
        });
      }

      return JSON.stringify({
        success: false,
        error: "Folder could not be opened",
        path: resolvedFolder.fsName || resolvedFolder.fullName,
      });
    }
    return JSON.stringify({ success: false, error: "Folder not found" });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
});

registerHostCommand(COMMON_HOST_COMMANDS.getDiagnostics, (): string =>
  JSON.stringify(getDiagnosticsSnapshot(getHostGlobalState())),
);

registerHostCommand(COMMON_HOST_COMMANDS.clearDiagnostics, (): string => {
  clearDiagnostics(getHostGlobalState());
  return JSON.stringify({ success: true });
});

// ============================================================
// XMP persistence
// ============================================================

/**
 * Load all XMP panel data from the active document.
 */
registerHostCommand(ILLUSTRATOR_HOST_COMMANDS.loadXmpSettings, (): string => {
  try {
    var data = xmpGetVariable(XMP_DATA_KEY);
    return data || "null";
  } catch (e) {
    return "null";
  }
});

/**
 * Save XMP panel data to the active document.
 */
registerHostCommand(ILLUSTRATOR_HOST_COMMANDS.saveXmpSettings, (dataJson: string): string => {
  try {
    xmpSetVariable(XMP_DATA_KEY, unwrapBridgeStringArg(dataJson));
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
});

/**
 * Clear all XMP panel data from the active document.
 */
registerHostCommand(ILLUSTRATOR_HOST_COMMANDS.clearXmpSettings, (): string => {
  try {
    xmpDeleteVariable(XMP_DATA_KEY);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
});

// ============================================================
// Font operations
// ============================================================

/**
 * Get all fonts used in the active document.
 */
registerHostCommand(ILLUSTRATOR_HOST_COMMANDS.getDocumentFonts, (): string => {
  try {
    return JSON.stringify(collectDocumentFonts());
  } catch (e) {
    return "[]";
  }
});

/**
 * Get fonts used in the document but not in the provided config.
 */
registerHostCommand(ILLUSTRATOR_HOST_COMMANDS.getMissingFonts, (fontConfigJson: string): string => {
  try {
    return JSON.stringify(findMissingFonts(fontConfigJson));
  } catch (e) {
    return "[]";
  }
});

registerHostCommand(
  AE_HOST_COMMANDS.getAeMissingFonts,
  (fontConfigJson: string, compId: string): string => {
    try {
      return JSON.stringify(
        aeFindMissingFonts(fontConfigJson, unwrapBridgeStringArg(compId) || null),
      );
    } catch (e) {
      return "[]";
    }
  },
);

// ============================================================
// Config file operations
// ============================================================

/**
 * Read all2html.config.json from the document directory.
 */
registerHostCommand(ILLUSTRATOR_HOST_COMMANDS.readConfigFile, (): string => {
  try {
    var docPath = app.activeDocument.path.fsName + "/";
    var paths = [docPath + "all2html.config.json", docPath + "ai2html-config.json"];

    for (var i = 0; i < paths.length; i++) {
      var f = new File(paths[i]);
      if (f.exists) {
        f.open("r");
        f.encoding = "UTF-8";
        var content = f.read();
        f.close();
        content = stripJsonComments(content);
        return content;
      }
    }
    return "null";
  } catch (e) {
    return "null";
  }
});

registerHostCommand(AE_HOST_COMMANDS.readAeConfigFile, (): string => aeReadConfigFile());

registerHostCommand(AE_HOST_COMMANDS.saveAeConfigFile, (configJson: string): string =>
  aeSaveConfigFile(unwrapBridgeStringArg(configJson)),
);

/**
 * Check if the document has an ai2html-settings text block.
 */
registerHostCommand(ILLUSTRATOR_HOST_COMMANDS.hasSettingsBlock, (): string => {
  try {
    if (findSettingsBlock()) {
      return "true";
    }
    return "false";
  } catch (e) {
    return "false";
  }
});

function findSettingsBlock(): TextFrame | null {
  var doc = app.activeDocument;
  for (var i = 0; i < doc.textFrames.length; i++) {
    var tf = doc.textFrames[i];
    try {
      var firstLine = tf.lines[0].contents;
      if (/^ai2html-settings\s*$/.test(firstLine)) {
        return tf;
      }
    } catch (e) {
      // Skip frames without text
    }
  }
  return null;
}

function parseSettingsBlock(tf: TextFrame): { [key: string]: string } {
  var settings: { [key: string]: string } = {};
  var lines = tf.contents.split(/[\r\n]/);
  lines.shift();
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/^\s+|\s+$/g, "");
    var entryMatch = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (entryMatch) {
      settings[entryMatch[1]] = entryMatch[2];
    }
  }
  return settings;
}

function createExportRunnerEnv() {
  return {
    globalState: getHostGlobalState(),
    createFile: (path: string): File => new File(path),
    evalFile: (file: File): void => {
      $.evalFile(file);
    },
    getCurrentScriptPath: (): string => decodeURI($.fileName as string),
    getTempDirPath: (): string => Folder.temp.fsName,
  };
}

function getIllustratorFallbackScriptPath(): string | null {
  try {
    return app.activeDocument.path.fsName + "/all2html.js";
  } catch (e) {
    return null;
  }
}

/**
 * Read parsed ai2html-settings values from the active document.
 */
registerHostCommand(ILLUSTRATOR_HOST_COMMANDS.readSettingsBlock, (): string => {
  try {
    var tf = findSettingsBlock();
    if (!tf) {
      return "{}";
    }
    return JSON.stringify(parseSettingsBlock(tf));
  } catch (e) {
    return "{}";
  }
});

// ============================================================
// Export execution
// ============================================================

/**
 * Run all2html export with panel-provided settings.
 *
 * Writes settings to a temp file, sets globals for the exporter to read,
 * then $.evalFile()s the assembled all2html.js script.
 */
registerHostCommand(
  ILLUSTRATOR_HOST_COMMANDS.runExport,
  (settingsJson: string, fontsJson: string): string => {
    var globalState = getHostGlobalState();
    installExporterDiagnosticSink(globalState);
    try {
      return runPanelExport(createExportRunnerEnv(), {
        settingsJson: unwrapBridgeStringArg(settingsJson),
        fontsJson: unwrapBridgeStringArg(fontsJson),
        scriptFileName: "all2html.js",
        missingScriptError: "Cannot find all2html.js. Expected at: ",
        failurePrefix: "Export failed: ",
        settingsPathGlobalKey: "__ALL2HTML_PANEL_SETTINGS_PATH__",
        tempSettingsFileName: "all2html-panel-settings.json",
        fallbackScriptPaths: [getIllustratorFallbackScriptPath()],
        onClearDiagnostics: (): void => {
          clearDiagnostics(globalState);
        },
        onLog: (level, message, detail): void => {
          logDiagnostic(globalState, "host", level, message, detail);
        },
        attachDiagnostics: (resultText, fallbackError): string =>
          attachDiagnosticsToResult(resultText, globalState, fallbackError),
      });
    } finally {
      uninstallExporterDiagnosticSink(globalState);
    }
  },
);

registerHostCommand(
  AE_HOST_COMMANDS.runAeExport,
  (settingsJson: string, fontsJson: string): string => {
    var globalState = getHostGlobalState();
    installExporterDiagnosticSink(globalState);
    try {
      return runPanelExport(createExportRunnerEnv(), {
        settingsJson: unwrapBridgeStringArg(settingsJson),
        fontsJson: unwrapBridgeStringArg(fontsJson),
        scriptFileName: "all2html-ae.jsx",
        missingScriptError: "Cannot find all2html-ae.jsx. Expected at: ",
        failurePrefix: "AE export failed: ",
        settingsValueGlobalKey: "__ALL2HTML_AE_PANEL_SETTINGS__",
        onClearDiagnostics: (): void => {
          clearDiagnostics(globalState);
        },
        onLog: (level, message, detail): void => {
          logDiagnostic(globalState, "host", level, message, detail);
        },
        attachDiagnostics: (resultText, fallbackError): string =>
          attachDiagnosticsToResult(resultText, globalState, fallbackError),
      });
    } finally {
      uninstallExporterDiagnosticSink(globalState);
    }
  },
);
