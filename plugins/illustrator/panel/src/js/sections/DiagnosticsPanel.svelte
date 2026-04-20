<script lang="ts">
  import Collapsible from "../components/Collapsible.svelte";
  import WarningList from "../components/WarningList.svelte";
  import type {
    AeRunResult,
    DiagnosticEntry,
    GroupedWarnings,
    RunResult,
  } from "../../shared/types";

  interface Props {
    result: RunResult | AeRunResult;
    title?: string;
  }

  let { result, title = "Diagnostics" }: Props = $props();

  let open = $state(false);

  const entries = $derived.by(() =>
    result.diagnostics && result.diagnostics.entries ? result.diagnostics.entries : [],
  );

  const warnings = $derived.by(() =>
    "warnings" in result ? (result.warnings as GroupedWarnings | undefined) : undefined,
  );

  const countLabel = $derived.by(() => {
    const count = entries.length;
    return count > 0 ? String(count) : undefined;
  });

  function formatEntry(entry: DiagnosticEntry): string {
    const parts = [entry.scope, entry.level, entry.message];
    if (entry.detail) parts.push(entry.detail);
    return parts.join(" | ");
  }

  function copyDiagnostics(): void {
    const lines: string[] = [];

    if ("error" in result && result.error) {
      lines.push(`result.error | ${result.error}`);
    }

    if (result.diagnostics?.lastError) {
      lines.push(`diagnostics.lastError | ${result.diagnostics.lastError}`);
    }

    for (const entry of entries) {
      lines.push(formatEntry(entry));
    }

    navigator.clipboard.writeText(lines.join("\n"));
  }
</script>

{#if warnings}
  <WarningList {warnings} />
{/if}

{#if ("error" in result && result.error) || entries.length > 0}
  <Collapsible {title} count={countLabel} bind:open>
    <div class="panel-note panel-note-warning diagnostics-panel">
      {#if "error" in result && result.error}
        <div><strong>Result error:</strong> {result.error}</div>
      {/if}
      {#if result.diagnostics?.lastError}
        <div><strong>Last host error:</strong> {result.diagnostics.lastError}</div>
      {/if}
      {#if entries.length > 0}
        <button class="btn-secondary diagnostics-copy" onclick={copyDiagnostics}>Copy</button>
        {#each entries as entry}
          <div class="diagnostics-entry">
            <code>{entry.scope}</code>
            <span>{entry.level}</span>
            <span>{entry.message}</span>
            {#if entry.detail}
              <code class="diagnostic-path">{entry.detail}</code>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </Collapsible>
{/if}
