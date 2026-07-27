/**
 * After Effects bridge from CEP panel to ExtendScript hostscript.
 */

import { HOST_COMMANDS } from "../shared/host-contract.js";
import type {
  AeCompInfo,
  AeProjectInfo,
  AeRunResult,
  AeTemplateCatalog,
  FontEntry,
} from "../shared/types.js";
import {
  callHostCommand,
  clearHostDiagnostics,
  getHostDiagnostics,
  normalizeStringListResult,
  openHostFolder,
  parseHostObjectResult,
} from "./bridge-shared.js";

export async function getAeProjectInfo(): Promise<AeProjectInfo | null> {
  return callHostCommand(HOST_COMMANDS.getAeProjectInfo);
}

export async function listAeComps(): Promise<AeCompInfo[]> {
  return callHostCommand(HOST_COMMANDS.listAeComps);
}

export async function getAeOutputTemplates(compId: string | null): Promise<AeTemplateCatalog> {
  return callHostCommand(HOST_COMMANDS.getAeOutputTemplates, compId ?? "");
}

export async function openFolder(path: string): Promise<void> {
  await openHostFolder(path);
}

export { clearHostDiagnostics, getHostDiagnostics };

export async function readAeConfigFile(): Promise<Record<string, unknown> | null> {
  const raw = await callHostCommand(HOST_COMMANDS.readAeConfigFile);
  return parseHostObjectResult(raw);
}

export async function saveAeConfigFile(configJson: string): Promise<void> {
  const result = await callHostCommand(HOST_COMMANDS.saveAeConfigFile, configJson);
  if (result && result.success === false) {
    throw new Error(result.error || "Failed to save AE config file.");
  }
}

export async function getAeMissingFonts(
  fonts: FontEntry[],
  compId: string | null,
): Promise<string[]> {
  const result = await callHostCommand(HOST_COMMANDS.getAeMissingFonts, fonts, compId ?? "");
  return normalizeStringListResult(result, "Unexpected getAeMissingFonts response");
}

export async function runAeExport(settingsJson: string, fontsJson: string): Promise<AeRunResult> {
  return callHostCommand(HOST_COMMANDS.runAeExport, settingsJson, fontsJson);
}
