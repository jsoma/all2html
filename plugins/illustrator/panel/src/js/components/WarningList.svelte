<script lang="ts">
  import type { GroupedWarnings } from "../../shared/types";
  import { copyText } from "../clipboard.js";

  interface Props {
    warnings: GroupedWarnings;
    open?: boolean;
  }

  let { warnings, open = $bindable(false) }: Props = $props();
  let copyLabel = $state("Copy");
  let copyResetTimer: number | undefined = undefined;

  const totalCount = $derived(
    Object.values(warnings).reduce((sum, arr) => sum + arr.length, 0),
  );

  const categories = $derived(
    (Object.entries(warnings) as [string, string[]][]).filter(
      ([, items]) => items.length > 0,
    ),
  );

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

  async function copyWarnings(): Promise<void> {
    const text = categories
      .map(([cat, items]) => `[${cat}]\n${items.join("\n")}`)
      .join("\n\n");
    setCopyLabel((await copyText(text)) ? "Copied" : "Copy failed");
  }
</script>

{#if totalCount > 0}
  <div class="warnings-panel">
    <div
      class="warnings-header"
      role="button"
      tabindex="0"
      aria-expanded={open}
      onclick={() => (open = !open)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') open = !open; }}
    >
      <span class="warnings-count">{totalCount} warning{totalCount !== 1 ? "s" : ""}</span>
      <button class="btn-secondary" onclick={(e) => { e.stopPropagation(); void copyWarnings(); }}>{copyLabel}</button>
    </div>
    {#if open}
      <div class="warnings-list">
        {#each categories as [category, items]}
          <div class="warning-category">{category}</div>
          {#each items as item}
            <div class="warning-item">{item}</div>
          {/each}
        {/each}
      </div>
    {/if}
  </div>
{/if}
