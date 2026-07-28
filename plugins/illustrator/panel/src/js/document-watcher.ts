/**
 * Polls for active document changes in Illustrator.
 * CEP has no reliable event for document switching, so we poll.
 */

import type { DocumentInfo } from "../shared/types.js";
import { getDocumentInfo } from "./bridge.js";
import { createPollingWatcher } from "./polling-watcher.js";

type DocumentChangeCallback = (doc: DocumentInfo | null) => void;

function getDocumentWatchKey(info: DocumentInfo | null): string | null {
  if (!info) return null;
  const settingsBlockSignature = info.settingsBlockSignature || "no-settings-block";
  if (info.path) {
    return `saved:${info.path}:${settingsBlockSignature}`;
  }
  return `unsaved:${info.name}:${settingsBlockSignature}`;
}

/**
 * Start polling for document changes.
 * Calls `callback` whenever the active document changes.
 */
export function startWatching(callback: DocumentChangeCallback, intervalMs = 1500): void {
  watcher.start(callback, intervalMs);
}

/**
 * Stop polling for document changes.
 */
export function stopWatching(): void {
  watcher.stop();
}

const watcher = createPollingWatcher<DocumentInfo | null>({
  poll: getDocumentInfo,
  keyOf: getDocumentWatchKey,
  resetKey: undefined,
});
