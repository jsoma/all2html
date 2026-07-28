/**
 * After Effects bridge from CEP panel to ExtendScript hostscript.
 *
 * evalTS returns `unknown`; the results that feed panel logic (project info,
 * comps, template catalog, export result) get small field-presence decoders
 * here, and mutations throw on the host's `{success: false}` shape.
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
  assertHostMutationSucceeded,
  callHostCommand,
  clearHostDiagnostics,
  describeHostResult,
  getHostDiagnostics,
  normalizeDiagnosticsPayload,
  normalizeStringListResult,
  openHostFolder,
  parseHostObjectResult,
} from "./bridge-shared.js";

function decodeAeProjectInfo(raw: unknown): AeProjectInfo | null {
  const parsed = parseHostObjectResult<Record<string, unknown>>(raw);
  if (!parsed) return null;
  if (
    typeof parsed.name !== "string" ||
    typeof parsed.saved !== "boolean" ||
    typeof parsed.compCount !== "number"
  ) {
    throw new Error(
      `Malformed project info from the After Effects host: ${describeHostResult(raw)}`,
    );
  }
  return {
    name: parsed.name,
    path: typeof parsed.path === "string" ? parsed.path : "",
    saved: parsed.saved,
    compCount: parsed.compCount,
    activeCompId: typeof parsed.activeCompId === "string" ? parsed.activeCompId : null,
    activeCompName: typeof parsed.activeCompName === "string" ? parsed.activeCompName : null,
  };
}

export async function getAeProjectInfo(): Promise<AeProjectInfo | null> {
  return decodeAeProjectInfo(await callHostCommand(HOST_COMMANDS.getAeProjectInfo));
}

function decodeAeCompList(raw: unknown): AeCompInfo[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error(
        `Malformed comps list from the After Effects host: ${describeHostResult(raw)}`,
      );
    }
  }
  if (!Array.isArray(value)) {
    throw new Error(`Malformed comps list from the After Effects host: ${describeHostResult(raw)}`);
  }
  const comps: AeCompInfo[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const comp = entry as Record<string, unknown>;
    if (typeof comp.id !== "string" || typeof comp.name !== "string") continue;
    comps.push({
      id: comp.id,
      name: comp.name,
      width: typeof comp.width === "number" ? comp.width : 0,
      height: typeof comp.height === "number" ? comp.height : 0,
      duration: typeof comp.duration === "number" ? comp.duration : 0,
      frameRate: typeof comp.frameRate === "number" ? comp.frameRate : 0,
    });
  }
  return comps;
}

export async function listAeComps(): Promise<AeCompInfo[]> {
  return decodeAeCompList(await callHostCommand(HOST_COMMANDS.listAeComps));
}

function decodeAeTemplateCatalog(raw: unknown): AeTemplateCatalog {
  const parsed = parseHostObjectResult<Record<string, unknown>>(raw);
  if (!parsed) {
    throw new Error(
      `Malformed template catalog from the After Effects host: ${describeHostResult(raw)}`,
    );
  }
  if (typeof parsed.error === "string" && parsed.error) {
    // e.g. a stale targetCompId — surface the host's real error.
    throw new Error(parsed.error);
  }
  return {
    outputModuleTemplates: normalizeStringListResult(
      parsed.outputModuleTemplates,
      "Unexpected getAeOutputTemplates response",
    ),
    canQueueInAME: parsed.canQueueInAME === true,
  };
}

export async function getAeOutputTemplates(compId: string | null): Promise<AeTemplateCatalog> {
  return decodeAeTemplateCatalog(
    await callHostCommand(HOST_COMMANDS.getAeOutputTemplates, compId ?? ""),
  );
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
  assertHostMutationSucceeded(result, "Saving the AE config file");
}

export async function getAeMissingFonts(
  fonts: FontEntry[],
  compId: string | null,
): Promise<string[]> {
  const result = await callHostCommand(HOST_COMMANDS.getAeMissingFonts, fonts, compId ?? "");
  const errorEnvelope = parseHostObjectResult<{ error?: unknown }>(result);
  if (errorEnvelope && typeof errorEnvelope.error === "string" && errorEnvelope.error) {
    // e.g. a stale targetCompId — surface the host's real error.
    throw new Error(errorEnvelope.error);
  }
  return normalizeStringListResult(result, "Unexpected getAeMissingFonts response");
}

function decodeAeRunResult(raw: unknown): AeRunResult {
  const parsed = parseHostObjectResult<Record<string, unknown>>(raw);
  if (!parsed) {
    throw new Error(`Malformed AE export result: ${describeHostResult(raw)}`);
  }

  const status = parsed.status;
  if (status === "complete" || status === "queued" || status === "failed") {
    // `status` is the one truth; drop any legacy/synthesized success boolean.
    const { success: _success, ...rest } = parsed;
    const result = rest as Partial<AeRunResult>;
    return {
      ...result,
      status,
      warnings: Array.isArray(result.warnings)
        ? result.warnings.filter((entry): entry is string => typeof entry === "string")
        : undefined,
    };
  }

  // The shared export runner reports its own failures (missing script, host
  // exception, no result) as {success: false, error} — map them to `failed`.
  if (parsed.success === false) {
    return {
      status: "failed",
      error: typeof parsed.error === "string" && parsed.error ? parsed.error : "AE export failed",
      diagnostics: normalizeDiagnosticsPayload(parsed.diagnostics),
    };
  }

  throw new Error(`Malformed AE export result (missing status): ${describeHostResult(raw)}`);
}

export async function runAeExport(settingsJson: string, fontsJson: string): Promise<AeRunResult> {
  return decodeAeRunResult(
    await callHostCommand(HOST_COMMANDS.runAeExport, settingsJson, fontsJson),
  );
}
