import type { AeProjectInfo } from "../shared/types.js";
import { getAeProjectInfo } from "./ae-bridge.js";
import { createPollingWatcher } from "./polling-watcher.js";

type ProjectChangeCallback = (project: AeProjectInfo | null) => void;

function getProjectWatchKey(info: AeProjectInfo | null): string | null {
  return info ? `${info.path || "unsaved"}::${info.activeCompId || "no-comp"}` : null;
}

export function startAeWatching(callback: ProjectChangeCallback, intervalMs = 1500): void {
  watcher.start(callback, intervalMs);
}

export function stopAeWatching(): void {
  watcher.stop();
}

const watcher = createPollingWatcher<AeProjectInfo | null>({
  poll: getAeProjectInfo,
  keyOf: getProjectWatchKey,
  resetKey: null,
});
