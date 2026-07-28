import type {
  AeCompInfo,
  AeProjectInfo,
  AeRunResult,
  AeTemplateCatalog,
  DiagnosticsPayload,
  DocumentInfo,
  FontEntry,
  RunResult,
} from "./types.js";

export const HOST_NAMESPACE = "com.all2html.panel";

export const COMMON_HOST_COMMANDS = {
  openFolder: "openFolder",
  getDiagnostics: "getDiagnostics",
  clearDiagnostics: "clearDiagnostics",
} as const;

export const ILLUSTRATOR_HOST_COMMANDS = {
  getDocumentInfo: "getDocumentInfo",
  getDocumentPath: "getDocumentPath",
  loadXmpSettings: "loadXmpSettings",
  saveXmpSettings: "saveXmpSettings",
  clearXmpSettings: "clearXmpSettings",
  getDocumentFonts: "getDocumentFonts",
  getMissingFonts: "getMissingFonts",
  readConfigFile: "readConfigFile",
  hasSettingsBlock: "hasSettingsBlock",
  readSettingsBlock: "readSettingsBlock",
  runExport: "runExport",
} as const;

export const AE_HOST_COMMANDS = {
  getAeProjectInfo: "getAeProjectInfo",
  listAeComps: "listAeComps",
  getAeOutputTemplates: "getAeOutputTemplates",
  readAeConfigFile: "readAeConfigFile",
  saveAeConfigFile: "saveAeConfigFile",
  getAeMissingFonts: "getAeMissingFonts",
  runAeExport: "runAeExport",
} as const;

export const HOST_COMMANDS = {
  openFolder: "openFolder",
  getDiagnostics: "getDiagnostics",
  clearDiagnostics: "clearDiagnostics",
  getDocumentInfo: "getDocumentInfo",
  getDocumentPath: "getDocumentPath",
  loadXmpSettings: "loadXmpSettings",
  saveXmpSettings: "saveXmpSettings",
  clearXmpSettings: "clearXmpSettings",
  getDocumentFonts: "getDocumentFonts",
  getMissingFonts: "getMissingFonts",
  readConfigFile: "readConfigFile",
  hasSettingsBlock: "hasSettingsBlock",
  readSettingsBlock: "readSettingsBlock",
  runExport: "runExport",
  getAeProjectInfo: "getAeProjectInfo",
  listAeComps: "listAeComps",
  getAeOutputTemplates: "getAeOutputTemplates",
  readAeConfigFile: "readAeConfigFile",
  saveAeConfigFile: "saveAeConfigFile",
  getAeMissingFonts: "getAeMissingFonts",
  runAeExport: "runAeExport",
} as const;

export type HostCommandName = (typeof HOST_COMMANDS)[keyof typeof HOST_COMMANDS];

export interface OpenFolderResult {
  success: boolean;
  error?: string;
  path?: string;
}

export interface HostCommandArgsMap {
  openFolder: [folderPath: string];
  getDiagnostics: [];
  clearDiagnostics: [];
  getDocumentInfo: [];
  getDocumentPath: [];
  loadXmpSettings: [];
  saveXmpSettings: [dataJson: string];
  clearXmpSettings: [];
  getDocumentFonts: [];
  getMissingFonts: [fonts: FontEntry[]];
  readConfigFile: [];
  hasSettingsBlock: [];
  readSettingsBlock: [];
  runExport: [settingsJson: string, fontsJson: string];
  getAeProjectInfo: [];
  listAeComps: [];
  getAeOutputTemplates: [compId: string];
  readAeConfigFile: [];
  saveAeConfigFile: [configJson: string];
  getAeMissingFonts: [fonts: FontEntry[], compId: string];
  runAeExport: [settingsJson: string, fontsJson: string];
}

export interface HostCommandResultMap {
  openFolder: OpenFolderResult;
  getDiagnostics: DiagnosticsPayload;
  clearDiagnostics: { success: boolean };
  getDocumentInfo: DocumentInfo | null;
  getDocumentPath: string;
  loadXmpSettings: string | null;
  saveXmpSettings: { success: boolean; error?: string };
  clearXmpSettings: { success: boolean; error?: string };
  getDocumentFonts: string[];
  getMissingFonts: unknown;
  readConfigFile: string;
  hasSettingsBlock: boolean | string;
  readSettingsBlock: string;
  runExport: RunResult;
  getAeProjectInfo: AeProjectInfo | null;
  listAeComps: AeCompInfo[];
  getAeOutputTemplates: AeTemplateCatalog;
  readAeConfigFile: string;
  saveAeConfigFile: { success: boolean; error?: string };
  getAeMissingFonts: unknown;
  runAeExport: AeRunResult;
}

export type HostCommandArgs<K extends HostCommandName> = HostCommandArgsMap[K];
export type HostCommandResult<K extends HostCommandName> = HostCommandResultMap[K];

/**
 * ExtendScript error → its message text. `String(anErrorObject)` spells
 * "Error: <message>", and every consumer that displays a host error adds its
 * own context prefix — so raw String(e) is how the panel ended up showing
 * "Could not load…: Error: Error: No composition is active". ES3-safe: the
 * hostscript bundle calls this too.
 */
export function hostErrorMessage(e: unknown): string {
  const withMessage = e as { message?: unknown };
  if (withMessage && typeof withMessage.message === "string" && withMessage.message) {
    return withMessage.message;
  }
  return String(e);
}
