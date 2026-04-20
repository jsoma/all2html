<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    active: boolean;
    title?: string | null;
    emptyMessage: string;
    body?: Snippet;
    footer?: Snippet;
  }

  let { active, title = null, emptyMessage, body, footer }: Props = $props();
</script>

<div class="all2html-panel">
  {#if !active}
    <div class="no-doc">
      {emptyMessage}
    </div>
  {:else}
    {#if title}
      <header class="panel-header">
        <span class="doc-name" title={title}>{title}</span>
      </header>
    {/if}

    <div class="panel-body">
      {#if body}
        {@render body()}
      {/if}
    </div>

    {#if footer}
      <footer class="panel-footer">
        {@render footer()}
      </footer>
    {/if}
  {/if}
</div>
