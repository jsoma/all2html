<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    count?: string;
    open?: boolean;
    children: Snippet;
  }

  let { title, count, open = $bindable(false), children }: Props = $props();
</script>

<div class="section">
  <button class="collapsible-header" onclick={() => (open = !open)}>
    <span class="collapsible-chevron" class:open>&#9654;</span>
    <span class="collapsible-title">{title}</span>
    {#if count}
      <span class="collapsible-count">({count})</span>
    {/if}
  </button>
  {#if open}
    <div class="collapsible-body">
      {@render children()}
    </div>
  {/if}
</div>
