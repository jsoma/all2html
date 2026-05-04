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
    const result = await options.run();
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

function resolveResultOutputPath(
  resultOutputPath: string | null | undefined,
  documentPath: string | null | undefined,
  configuredOutputPath: string | null | undefined,
): string | null {
  const explicit = String(resultOutputPath || "").trim();
  if (explicit) return explicit;

  const basePath = String(documentPath || "").trim().replace(/[\\/]+$/, "");
  const fallback = String(configuredOutputPath || "").trim();
  if (!basePath || !fallback) return null;

  // Preserve explicit absolute paths and user-home shorthand.
  if (/^(~[/\\]?|[A-Za-z]:[\\/]|\/)/.test(fallback)) {
    return fallback;
  }

  const separator = basePath.includes("\\") ? "\\" : "/";
  return `${basePath}${separator}${fallback.replace(/^[/\\]+/, "")}`;
}

export { openResultFolder, reloadWatchedHostState, resolveResultOutputPath, runPanelTask };
