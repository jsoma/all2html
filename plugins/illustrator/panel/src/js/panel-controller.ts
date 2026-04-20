interface ReloadWatchedStateOptions<TInfo> {
  setInfo: (info: TInfo | null) => void;
  clearResult?: () => void;
  onPresent: (info: TInfo) => Promise<void> | void;
  onAbsent: () => void;
}

interface RunPanelTaskOptions<TResult> {
  isRunning: boolean;
  setRunning: (running: boolean) => void;
  setResult: (result: TResult | null) => void;
  beforeRun?: () => Promise<void> | void;
  run: () => Promise<TResult>;
  afterSuccess?: (result: TResult) => Promise<void> | void;
  mapError: (error: unknown) => TResult;
}

async function reloadWatchedHostState<TInfo>(
  info: TInfo | null,
  options: ReloadWatchedStateOptions<TInfo>,
): Promise<void> {
  options.setInfo(info);
  options.clearResult?.();

  if (info) {
    await options.onPresent(info);
    return;
  }

  options.onAbsent();
}

async function runPanelTask<TResult>(
  options: RunPanelTaskOptions<TResult>,
): Promise<void> {
  if (options.isRunning) return;

  options.setRunning(true);
  options.setResult(null);

  try {
    await options.beforeRun?.();
    var result = await options.run();
    options.setResult(result);
    await options.afterSuccess?.(result);
  } catch (e) {
    options.setResult(options.mapError(e));
  } finally {
    options.setRunning(false);
  }
}

function openResultFolder(
  outputPath: string | null | undefined,
  openFolder: (path: string) => Promise<void> | void,
): void {
  if (!outputPath) return;
  Promise.resolve(openFolder(outputPath)).catch((error) => {
    console.error("Failed to open output folder", error);
  });
}

export { openResultFolder, reloadWatchedHostState, runPanelTask };
