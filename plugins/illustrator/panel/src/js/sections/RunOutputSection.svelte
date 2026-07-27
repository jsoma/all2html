<script lang="ts">
  import { normalizeGroupedWarnings, type RunResult } from "../../shared/types";
  import { openFolder } from "../bridge";
  import Collapsible from "../components/Collapsible.svelte";
  import WarningList from "../components/WarningList.svelte";
  import DiagnosticsPanel from "./DiagnosticsPanel.svelte";
  import { openResultFolder } from "../panel-controller";

  interface Props {
    result: RunResult;
    outputPath?: string | null;
  }

  let { result, outputPath = null }: Props = $props();
  let lastRunOpen = $state(true);
  let warningListOpen = $state(false);
  let diagnosticsOpen = $state(false);
  let initializedForKey = $state("");

  // The host payload is ExtendScript output, so it is normalized before it is
  // counted or rendered — `Object.values()` over a string that was declared to be
  // a grouped object counts characters. See `normalizeGroupedWarnings`.
  const warnings = $derived(normalizeGroupedWarnings(result.warnings));
  const warningCount = $derived(
    Object.values(warnings).reduce((sum, items) => sum + items.length, 0),
  );

  const hasWarnings = $derived(warningCount > 0);
  const tone = $derived.by(() => (!result.success ? "error" : hasWarnings ? "warning" : "success"));
  const statusLabel = $derived.by(() => (!result.success ? "Error" : hasWarnings ? "Warnings" : "Success"));
  const resultKey = $derived.by(() =>
    [
      result.success ? "success" : "error",
      result.slug || "",
      result.error || "",
      result.elapsed || "",
      String(warningCount),
    ].join("|"),
  );

  const summaryText = $derived.by(() => {
    if (!result.success) {
      return String(result.error || "Export failed").split("\n")[0].trim();
    }

    const parts: string[] = [];
    if (result.artboardCount != null) {
      parts.push(`${result.artboardCount} artboard${result.artboardCount !== 1 ? "s" : ""}`);
    }
    if (result.imageCount != null) {
      parts.push(`${result.imageCount} image${result.imageCount !== 1 ? "s" : ""}`);
    }
    if (result.elapsed) {
      parts.push(result.elapsed);
    }
    return parts.join(" · ") || "Export completed";
  });

  $effect(() => {
    if (initializedForKey === resultKey) return;
    initializedForKey = resultKey;
    lastRunOpen = true;
    warningListOpen = warningCount > 0;
    diagnosticsOpen = !result.success;
  });

  function handleOpenFolder(): void {
    openResultFolder(outputPath, openFolder);
  }
</script>

<div class="section-run-output">
  <Collapsible title="Last run" bind:open={lastRunOpen}>
    <div class="run-output-card">
      <div class="run-output-summary">
        <div class="run-output-copy">
          <span class="run-output-pill" class:success={tone === "success"} class:warning={tone === "warning"} class:error={tone === "error"}>
            {statusLabel}
          </span>
          <span class="run-output-text">{summaryText}</span>
        </div>

        {#if outputPath}
          <button class="btn-secondary" type="button" onclick={handleOpenFolder}>Open folder</button>
        {/if}
      </div>
    </div>

    {#if hasWarnings}
      {#key resultKey}
        <WarningList warnings={warnings} bind:open={warningListOpen} />
      {/key}
    {/if}
  </Collapsible>

  {#key resultKey}
    <DiagnosticsPanel result={result} title="Log" bind:open={diagnosticsOpen} />
  {/key}
</div>
