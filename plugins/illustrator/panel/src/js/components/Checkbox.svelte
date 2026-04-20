<script lang="ts">
  interface Props {
    label: string;
    checked: boolean;
    onchange?: () => void;
    disabled?: boolean;
    locked?: boolean;
    badge?: string;
    badgeTitle?: string;
  }

  let {
    label,
    checked = $bindable(),
    onchange,
    disabled = false,
    locked = false,
    badge = "",
    badgeTitle,
  }: Props = $props();
</script>

<div class="field" class:field-locked={locked}>
  <label class="checkbox-wrapper" title={locked ? "Controlled by ai2html-settings in the document" : undefined}>
    <input type="checkbox" bind:checked onchange={onchange} {disabled} />
    <span>{label}</span>
    {#if badge}
      <span class="field-badge" title={badgeTitle}>{badge}</span>
    {/if}
  </label>
</div>
