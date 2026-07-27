/**
 * Type-safe bridge from CEP panel to ExtendScript hostscript.
 * Wraps evalTS for each hostscript function with proper typing.
 */

import { HOST_COMMANDS } from "../shared/host-contract.js";
import type { DocumentInfo, FontEntry, RunResult, XmpData } from "../shared/types.js";
import {
  callHostCommand,
  clearHostDiagnostics,
  getHostDiagnostics,
  normalizeStringListResult,
  openHostFolder,
  parseHostObjectResult,
} from "./bridge-shared.js";

/** Get info about the active Illustrator document. */
export async function getDocumentInfo(): Promise<DocumentInfo | null> {
  return callHostCommand(HOST_COMMANDS.getDocumentInfo);
}

/** Get the document directory path. */
export async function getDocumentPath(): Promise<string> {
  return callHostCommand(HOST_COMMANDS.getDocumentPath);
}

/** Open a folder in the OS file browser. */
export async function openFolder(path: string): Promise<void> {
  await openHostFolder(path);
}

export { clearHostDiagnostics, getHostDiagnostics };

/** Load XMP settings from the active document. */
export async function loadXmpSettings(): Promise<string | XmpData | null> {
  return callHostCommand(HOST_COMMANDS.loadXmpSettings);
}

/** Save XMP data to the active document. */
export async function saveXmpSettings(dataJson: string): Promise<void> {
  await callHostCommand(HOST_COMMANDS.saveXmpSettings, dataJson);
}

/** Clear XMP data from the active document. */
export async function clearXmpSettings(): Promise<void> {
  await callHostCommand(HOST_COMMANDS.clearXmpSettings);
}

/** Get all font names used in the active document. */
export async function getDocumentFonts(): Promise<string[]> {
  return callHostCommand(HOST_COMMANDS.getDocumentFonts);
}

/** Get fonts used in the document but not in the provided config. */
export async function getMissingFonts(fonts: FontEntry[]): Promise<string[]> {
  const result = await callHostCommand(HOST_COMMANDS.getMissingFonts, fonts);
  return normalizeStringListResult(result, "Unexpected getMissingFonts response");
}

/** Read the config file from the document directory. */
export async function readConfigFile(): Promise<Record<string, unknown> | null> {
  const raw = await callHostCommand(HOST_COMMANDS.readConfigFile);
  return parseHostObjectResult(raw, 1);
}

/** Check if the document has an ai2html-settings text block. */
export async function hasSettingsBlock(): Promise<boolean> {
  const result = await callHostCommand(HOST_COMMANDS.hasSettingsBlock);
  return result === "true" || (result as unknown) === true;
}

/** Read parsed ai2html-settings values from the active document. */
export async function readSettingsBlock(): Promise<Record<string, unknown>> {
  const raw = await callHostCommand(HOST_COMMANDS.readSettingsBlock);
  return parseHostObjectResult(raw, 1) ?? {};
}

/** Run all2html export with the given settings. */
export async function runExport(settingsJson: string, fontsJson: string): Promise<RunResult> {
  return callHostCommand(HOST_COMMANDS.runExport, settingsJson, fontsJson);
}
