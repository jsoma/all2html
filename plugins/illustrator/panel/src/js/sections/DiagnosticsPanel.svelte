<script lang="ts">
  import Collapsible from "../components/Collapsible.svelte";
  import type {
    AeRunResult,
    DiagnosticEntry,
    RunResult,
  } from "../../shared/types";
  import { copyText } from "../clipboard.js";

  interface Props {
    result: RunResult | AeRunResult;
    title?: string;
    open?: boolean;
  }

  let { result, title = "Diagnostics", open = $bindable(false) }: Props = $props();
  let copyLabel = $state("Copy");
  let copyResetTimer: number | undefined = undefined;

  const entries = $derived.by(() =>
    result.diagnostics && result.diagnostics.entries ? result.diagnostics.entries : [],
  );

  const countLabel = $derived.by(() => {
    const count = entries.length;
    return count > 0 ? String(count) : undefined;
  });

  const hasContent = $derived.by(
    () =>
      ("error" in result && !!result.error) ||
      !!result.diagnostics?.lastError ||
      entries.length > 0,
  );

  function formatEntry(entry: DiagnosticEntry): string {
    const parts = [entry.scope, entry.level, entry.message];
    if (entry.detail) parts.push(entry.detail);
    return parts.join(" | ");
  }

  function setCopyLabel(label: string): void {
    copyLabel = label;
    if (copyResetTimer !== undefined) {
      window.clearTimeout(copyResetTimer);
    }
    copyResetTimer = window.setTimeout(() => {
      copyLabel = "Copy";
      copyResetTimer = undefined;
    }, 1500);
  }

  async function copyDiagnostics(): Promise<void> {
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

    setCopyLabel((await copyText(lines.join("\n"))) ? "Copied" : "Copy failed");
  }
</script>

{#if hasContent}
  <Collapsible {title} count={countLabel} bind:open>
    <div class="diagnostics-panel">
      {#if "error" in result && result.error}
        <div><strong>Result error:</strong> {result.error}</div>
      {/if}
      {#if result.diagnostics?.lastError}
        <div><strong>Last host error:</strong> {result.diagnostics.lastError}</div>
      {/if}
      {#if entries.length > 0}
        <div class="diagnostics-toolbar">
          <button class="btn-secondary diagnostics-copy" onclick={() => void copyDiagnostics()}>{copyLabel}</button>
        </div>
        <div class="diagnostics-log">
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
        </div>
      {/if}
    </div>
  </Collapsible>
{/if}
