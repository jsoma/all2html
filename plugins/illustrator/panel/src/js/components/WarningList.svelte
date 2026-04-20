<script lang="ts">
  import type { GroupedWarnings } from "../../shared/types";

  interface Props {
    warnings: GroupedWarnings;
  }

  let { warnings }: Props = $props();

  let expanded = $state(false);

  const totalCount = $derived(
    Object.values(warnings).reduce((sum, arr) => sum + arr.length, 0),
  );

  const categories = $derived(
    (Object.entries(warnings) as [string, string[]][]).filter(
      ([, items]) => items.length > 0,
    ),
  );

  function copyWarnings(): void {
    const text = categories
      .map(([cat, items]) => `[${cat}]\n${items.join("\n")}`)
      .join("\n\n");
    navigator.clipboard.writeText(text);
  }
</script>

{#if totalCount > 0}
  <div class="warnings-panel">
    <div class="warnings-header" role="button" tabindex="0" onclick={() => (expanded = !expanded)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') expanded = !expanded; }}>
      <span class="warnings-count">{totalCount} warning{totalCount !== 1 ? "s" : ""}</span>
      <button class="btn-secondary" onclick={(e) => { e.stopPropagation(); copyWarnings(); }}>Copy</button>
    </div>
    {#if expanded}
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
