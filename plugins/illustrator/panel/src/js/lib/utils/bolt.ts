/**
 * Bolt CEP utilities — evalTS bridge and initialization.
 * Adapted from hyperbrew/bolt-cep for all2html.
 */

import { HOST_NAMESPACE } from "../../../shared/host-contract.js";

// CSInterface is loaded before the app boots from public/CSInterface.js.
declare class CSInterface {
  evalScript(script: string, callback?: (result: string) => void): void;
  getSystemPath(pathType: string): string;
  getApplicationID(): string;
  requestOpenExtension(extensionId: string): void;
  openURLInDefaultBrowser(url: string): void;
  addEventListener(type: string, listener: (event: CSEvent) => void): void;
  removeEventListener(type: string, listener: (event: CSEvent) => void): void;
}

declare interface CSEvent {
  type: string;
  data: string;
}

// SystemPath constants
const SystemPath = {
  USER_DATA: "userData",
  COMMON_FILES: "commonFiles",
  MY_DOCUMENTS: "myDocuments",
  APPLICATION: "application",
  EXTENSION: "extension",
  HOST_APPLICATION: "hostApplication",
};

let csi: CSInterface | null = null;

function getCsi(): CSInterface {
  if (!csi) {
    const CSInterfaceCtor = (globalThis as { CSInterface?: new () => CSInterface })
      .CSInterface;
    if (!CSInterfaceCtor) {
      throw new Error("CSInterface.js is not loaded");
    }
    csi = new CSInterfaceCtor();
  }
  return csi;
}

/**
 * Initialize the ExtendScript layer by loading the compiled hostscript.
 */
export function initBolt(): void {
  const csi = getCsi();
  const extPath = csi.getSystemPath(SystemPath.EXTENSION);
  const jsxPath = `${extPath}/jsx/hostscript.js`;
  csi.evalScript(`$.evalFile("${jsxPath.replace(/\\/g, "/")}")`);
}

/**
 * Type-safe ExtendScript function call.
 * Calls $["com.all2html.panel"].functionName(...args) and parses the JSON result.
 */
export function evalTS<T = unknown>(
  fnName: string,
  ...args: unknown[]
): Promise<T> {
  return new Promise((resolve, reject) => {
    const csi = getCsi();
    const serializedArgs = args
      .map((a) => {
        const json = JSON.stringify(a);
        // Double-encode strings so ExtendScript gets a string argument
        return typeof a === "string" ? JSON.stringify(json) : json;
      })
      .join(", ");

    const script = `$["${HOST_NAMESPACE}"].${fnName}(${serializedArgs})`;

    csi.evalScript(script, (result: string) => {
      if (result === "EvalScript error.") {
        reject(new Error(`evalTS("${fnName}") failed`));
        return;
      }
      try {
        resolve(JSON.parse(result) as T);
      } catch {
        // If not valid JSON, return as-is
        resolve(result as unknown as T);
      }
    });
  });
}

/**
 * Get the CEP extension directory path.
 */
export function getExtensionPath(): string {
  const csi = getCsi();
  return csi.getSystemPath(SystemPath.EXTENSION);
}

export function getHostApplicationId(): string {
  const csi = getCsi();
  return csi.getApplicationID();
}

/**
 * Get the user data directory for app-level persistence.
 */
export function getUserDataPath(): string {
  const csi = getCsi();
  return csi.getSystemPath(SystemPath.USER_DATA) + "/all2html/";
}

/**
 * Open a URL in the default browser.
 */
export function openUrl(url: string): void {
  const csi = getCsi();
  csi.openURLInDefaultBrowser(url);
}

/**
 * Listen for CEP events.
 */
export function addEventListener(
  type: string,
  callback: (event: CSEvent) => void,
): void {
  const csi = getCsi();
  csi.addEventListener(type, callback);
}

export { SystemPath };
