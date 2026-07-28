/**
 * Type-safe bridge from CEP panel to ExtendScript hostscript.
 * Wraps evalTS for each hostscript function.
 *
 * evalTS returns `unknown`; the results that feed panel logic (document info,
 * export results) get small field-presence decoders here, list/object results
 * reuse the shared normalizers, and mutations throw on `{success: false}`.
 */

import { HOST_COMMANDS } from "../shared/host-contract.js";
import type { DocumentInfo, FontEntry, RunResult } from "../shared/types.js";
import {
  assertHostMutationSucceeded,
  callHostCommand,
  clearHostDiagnostics,
  describeHostResult,
  getHostDiagnostics,
  normalizeStringListResult,
  openHostFolder,
  parseHostObjectResult,
} from "./bridge-shared.js";

function decodeDocumentInfo(raw: unknown): DocumentInfo | null {
  const parsed = parseHostObjectResult<Record<string, unknown>>(raw);
  if (!parsed) return null;
  if (
    typeof parsed.name !== "string" ||
    typeof parsed.saved !== "boolean" ||
    typeof parsed.artboardCount !== "number"
  ) {
    throw new Error(
      `Malformed document info from the Illustrator host: ${describeHostResult(raw)}`,
    );
  }
  return {
    name: parsed.name,
    path: typeof parsed.path === "string" ? parsed.path : "",
    saved: parsed.saved,
    artboardCount: parsed.artboardCount,
    settingsBlockSignature:
      typeof parsed.settingsBlockSignature === "string" ? parsed.settingsBlockSignature : null,
  };
}

/** Get info about the active Illustrator document. */
export async function getDocumentInfo(): Promise<DocumentInfo | null> {
  return decodeDocumentInfo(await callHostCommand(HOST_COMMANDS.getDocumentInfo));
}

/** Get the document directory path. */
export async function getDocumentPath(): Promise<string> {
  const result = await callHostCommand(HOST_COMMANDS.getDocumentPath);
  return typeof result === "string" ? result : "";
}

/** Open a folder in the OS file browser. */
export async function openFolder(path: string): Promise<void> {
  await openHostFolder(path);
}

export { clearHostDiagnostics, getHostDiagnostics };

/** Load XMP settings from the active document. Raw host payload; the caller parses. */
export async function loadXmpSettings(): Promise<unknown> {
  return callHostCommand(HOST_COMMANDS.loadXmpSettings);
}

/** Save XMP data to the active document. */
export async function saveXmpSettings(dataJson: string): Promise<void> {
  const result = await callHostCommand(HOST_COMMANDS.saveXmpSettings, dataJson);
  assertHostMutationSucceeded(result, "Saving document settings");
}

/** Clear XMP data from the active document. */
export async function clearXmpSettings(): Promise<void> {
  const result = await callHostCommand(HOST_COMMANDS.clearXmpSettings);
  assertHostMutationSucceeded(result, "Clearing document settings");
}

/** Get all font names used in the active document. */
export async function getDocumentFonts(): Promise<string[]> {
  const result = await callHostCommand(HOST_COMMANDS.getDocumentFonts);
  return normalizeStringListResult(result, "Unexpected getDocumentFonts response");
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
  return result === "true" || result === true;
}

/** Read parsed ai2html-settings values from the active document. */
export async function readSettingsBlock(): Promise<Record<string, unknown>> {
  const raw = await callHostCommand(HOST_COMMANDS.readSettingsBlock);
  return parseHostObjectResult(raw, 1) ?? {};
}

function decodeRunResult(raw: unknown): RunResult {
  const parsed = parseHostObjectResult<Record<string, unknown>>(raw);
  if (!parsed || typeof parsed.success !== "boolean") {
    throw new Error(
      `Malformed export result from the Illustrator host: ${describeHostResult(raw)}`,
    );
  }
  return parsed as unknown as RunResult;
}

/** Run all2html export with the given settings. */
export async function runExport(settingsJson: string, fontsJson: string): Promise<RunResult> {
  return decodeRunResult(await callHostCommand(HOST_COMMANDS.runExport, settingsJson, fontsJson));
}
