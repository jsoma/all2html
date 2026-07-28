<script lang="ts">
  import type { RunResult } from "../../shared/types";
  import { openFolder } from "../bridge";
  import { openResultFolder } from "../panel-controller";

  interface Props {
    isRunning: boolean;
    result: RunResult | null;
    outputPath?: string | null;
    onreview?: () => void;
    onrun: () => void;
  }

  let { isRunning, result, outputPath = null, onreview, onrun }: Props = $props();

  const warningCount = $derived.by(() =>
    result?.warnings
      ? Object.values(result.warnings).reduce((sum, items) => sum + items.length, 0)
      : 0,
  );

  const hasError = $derived.by(() => !!result && !result.success);
  const hasWarnings = $derived.by(() => !!result?.success && warningCount > 0);
  // A clean run used to render nothing at all: the button returned to its
  // resting label and the only proof the export happened was the filesystem.
  const isClean = $derived.by(() => !!result?.success && warningCount === 0);

  const alertMessage = $derived.by(() => {
    if (!result) return "";
    if (!result.success) {
      return String(result.error || "Export failed").split("\n")[0].trim();
    }
    if (warningCount === 0) {
      const artboards = result.artboardCount ?? 0;
      const images = result.imageCount ?? 0;
      return `${artboards} artboard${artboards !== 1 ? "s" : ""}, ${images} image${images !== 1 ? "s" : ""}${result.elapsed ? ` in ${result.elapsed}` : ""}`;
    }
    return `${warningCount} warning${warningCount !== 1 ? "s" : ""} from last export`;
  });

  function handleOpenFolder(): void {
    openResultFolder(outputPath, openFolder);
  }
</script>

<div class="run-action-bar">
  {#if hasError || hasWarnings || isClean}
    <div
      class="run-alert-strip"
      class:error={hasError}
      class:warning={hasWarnings}
      class:success={isClean}
    >
      <div class="run-alert-copy">
        <strong>{hasError ? "Export failed" : isClean ? "Exported" : "Warnings"}</strong>
        <span>{alertMessage}</span>
      </div>
      <div class="run-alert-actions">
        {#if onreview}
          <button class="run-link-button" type="button" onclick={onreview}>Review</button>
        {/if}
        {#if outputPath}
          <button class="run-link-button" type="button" onclick={handleOpenFolder}>Open folder</button>
        {/if}
      </div>
    </div>
  {/if}

  <button class="btn-primary" disabled={isRunning} onclick={onrun}>
    {#if isRunning}
      <span class="spinner"></span> Running...
    {:else}
      Run all2html
    {/if}
  </button>
</div>
