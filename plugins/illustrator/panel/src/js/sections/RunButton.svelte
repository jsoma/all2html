<script lang="ts">
  import type { RunResult } from "../../shared/types";
  import { openFolder } from "../bridge";
  import RunResultRow from "../components/RunResult.svelte";
  import { openResultFolder } from "../panel-controller";

  interface Props {
    isRunning: boolean;
    result: RunResult | null;
    onrun: () => void;
  }

  let { isRunning, result, onrun }: Props = $props();

  function handleOpenFolder(): void {
    openResultFolder(result?.outputPath, openFolder);
  }
</script>

<div class="section">
  <button class="btn-primary" disabled={isRunning} onclick={onrun}>
    {#if isRunning}
      <span class="spinner"></span> Running...
    {:else}
      Run all2html
    {/if}
  </button>

  {#if result}
    {#if result.success}
      <RunResultRow
        success={true}
        message={`${result.artboardCount} artboard${result.artboardCount !== 1 ? "s" : ""}, ${result.elapsed}`}
        outputPath={result.outputPath}
        onopenfolder={handleOpenFolder}
      />
    {:else}
      <RunResultRow success={false} message={result.error || "Export failed"} />
    {/if}
  {/if}
</div>
