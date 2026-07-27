import {
  HOST_COMMANDS,
  type HostCommandArgs,
  type HostCommandName,
  type HostCommandResult,
  type OpenFolderResult,
} from "../shared/host-contract.js";
import type { DiagnosticsPayload } from "../shared/types.js";
import { evalTS } from "./lib/utils/bolt.js";

export function callHostCommand<K extends HostCommandName>(
  command: K,
  ...args: HostCommandArgs<K>
): Promise<HostCommandResult<K>> {
  return evalTS<HostCommandResult<K>>(command, ...args);
}

export function normalizeStringListResult(result: unknown, errorLabel: string): string[] {
  if (Array.isArray(result)) {
    return result.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
  }

  if (typeof result === "string") {
    try {
      return normalizeStringListResult(JSON.parse(result), errorLabel);
    } catch {
      console.error(`${errorLabel}:`, result);
      return [];
    }
  }

  return [];
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseHostObjectResult<T extends object>(raw: unknown, maxDepth = 2): T | null {
  let current = raw;

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (!current || current === "null") {
      return null;
    }

    if (isRecordLike(current)) {
      return current as T;
    }

    if (typeof current !== "string") {
      return null;
    }

    try {
      current = JSON.parse(current);
    } catch {
      return null;
    }
  }

  return isRecordLike(current) ? (current as T) : null;
}

function canUseNodeFolderOpen(): boolean {
  return typeof document !== "undefined" && typeof (globalThis as any).require === "function";
}

function normalizeFolderPath(path: string): string {
  const trimmed = String(path || "")
    .trim()
    .replace(/^"(.*)"$/, "$1");

  if (!canUseNodeFolderOpen()) {
    return trimmed;
  }

  const nodeRequire = (globalThis as any).require as NodeRequire;
  const os = nodeRequire("os") as typeof import("os");
  const nodePath = nodeRequire("path") as typeof import("path");

  if (trimmed === "~") {
    return os.homedir();
  }

  if (trimmed.startsWith("~/")) {
    return nodePath.join(os.homedir(), trimmed.slice(2));
  }

  return trimmed;
}

async function openFolderViaNode(path: string): Promise<boolean> {
  if (!canUseNodeFolderOpen()) {
    return false;
  }

  const nodeRequire = (globalThis as any).require as NodeRequire;
  const fs = nodeRequire("fs") as typeof import("fs");
  const childProcess = nodeRequire("child_process") as typeof import("child_process");
  const os = nodeRequire("os") as typeof import("os");
  const normalizedPath = normalizeFolderPath(path);
  const platform = os.platform();

  if (!fs.existsSync(normalizedPath)) {
    throw new Error("Folder not found");
  }

  const command = platform === "win32" ? "cmd.exe" : platform === "darwin" ? "open" : "xdg-open";
  const args =
    platform === "win32"
      ? ["/d", "/s", "/c", `start "" "${normalizedPath.replace(/\//g, "\\").replace(/"/g, '""')}"`]
      : [normalizedPath];

  await new Promise<void>((resolve, reject) => {
    childProcess.execFile(command, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return true;
}

export async function openHostFolder(path: string): Promise<void> {
  if (await openFolderViaNode(path)) {
    return;
  }

  const result: OpenFolderResult = await callHostCommand(HOST_COMMANDS.openFolder, path);
  if (result && result.success === false) {
    throw new Error(result.error || `Failed to open folder: ${path}`);
  }
}

export function getHostDiagnostics(): Promise<DiagnosticsPayload> {
  return callHostCommand(HOST_COMMANDS.getDiagnostics);
}

export async function clearHostDiagnostics(): Promise<void> {
  await callHostCommand(HOST_COMMANDS.clearDiagnostics);
}
