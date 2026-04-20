<script lang="ts">
  interface Props {
    success: boolean;
    message: string;
    outputPath?: string | null;
    onopenfolder?: () => void;
  }

  let { success, message, outputPath = null, onopenfolder }: Props = $props();
</script>

<div class="run-result" class:success class:error={!success}>
  <span>{success ? "\u2713" : "\u2717"} {message}</span>
  {#if success && outputPath && onopenfolder}
    <button type="button" class="open-folder" onclick={onopenfolder}>Open folder</button>
  {/if}
</div>
