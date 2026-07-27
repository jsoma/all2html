type DiagnosticLevel = "info" | "warn" | "error";
type DiagnosticScope = "host" | "illustrator-exporter" | "ae-exporter";

type DiagnosticEntry = {
  scope: DiagnosticScope;
  level: DiagnosticLevel;
  message: string;
  detail?: string;
  timestamp: string;
};

type DiagnosticsState = {
  entries: DiagnosticEntry[];
  lastError?: string;
};

var DIAGNOSTICS_KEY = "__ALL2HTML_DIAGNOSTICS__";
var DIAGNOSTIC_LIMIT = 200;

function getDiagnosticsState(globalState: any): DiagnosticsState {
  if (!globalState[DIAGNOSTICS_KEY]) {
    globalState[DIAGNOSTICS_KEY] = {
      entries: [],
      lastError: "",
    };
  }
  return globalState[DIAGNOSTICS_KEY] as DiagnosticsState;
}

function clearDiagnostics(globalState: any): void {
  globalState[DIAGNOSTICS_KEY] = {
    entries: [],
    lastError: "",
  };
}

function logDiagnostic(
  globalState: any,
  scope: DiagnosticScope,
  level: DiagnosticLevel,
  message: string,
  detail?: string,
): void {
  var state = getDiagnosticsState(globalState);
  state.entries.push({
    scope: scope,
    level: level,
    message: String(message || ""),
    detail: detail ? String(detail) : undefined,
    timestamp: String(new Date()),
  });

  if (level === "error") {
    state.lastError = String(message || detail || "Unknown error");
  }

  while (state.entries.length > DIAGNOSTIC_LIMIT) {
    state.entries.shift();
  }
}

function getDiagnosticsSnapshot(globalState: any): DiagnosticsState {
  var state = getDiagnosticsState(globalState);
  return {
    entries: state.entries.slice(0),
    lastError: state.lastError || undefined,
  };
}

function attachDiagnosticsToResult(
  resultText: string,
  globalState: any,
  fallbackError: string,
): string {
  var diagnostics = getDiagnosticsSnapshot(globalState);
  var text = String(resultText || "");

  try {
    var parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      parsed.diagnostics = diagnostics;
      if (parsed.success === undefined) {
        parsed.success = !parsed.error;
      }
      return JSON.stringify(parsed);
    }
  } catch (e) {}

  return JSON.stringify({
    success: false,
    error: text || fallbackError,
    diagnostics: diagnostics,
  });
}

function installExporterDiagnosticSink(globalState: any): void {
  globalState.__ALL2HTML_LOG__ = (
    scope: DiagnosticScope,
    level: DiagnosticLevel,
    message: string,
    detail?: string,
  ): void => {
    logDiagnostic(globalState, scope, level, message, detail);
  };
}

function uninstallExporterDiagnosticSink(globalState: any): void {
  delete globalState.__ALL2HTML_LOG__;
}

export {
  attachDiagnosticsToResult,
  clearDiagnostics,
  getDiagnosticsSnapshot,
  installExporterDiagnosticSink,
  logDiagnostic,
  uninstallExporterDiagnosticSink,
};
