<script lang="ts">
  interface Props {
    label: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onchange?: () => void;
    disabled?: boolean;
    locked?: boolean;
    badge?: string;
    badgeTitle?: string;
  }

  let {
    label,
    value = $bindable(),
    options,
    onchange,
    disabled = false,
    locked = false,
    badge = "",
    badgeTitle,
  }: Props = $props();
</script>

<div class="field" class:field-locked={locked}>
  <span class="field-label">
    {label}
    {#if badge}
      <span class="field-badge" title={badgeTitle}>{badge}</span>
    {/if}
  </span>
  <div class="field-control">
    <select bind:value onchange={onchange} {disabled} title={locked ? "Controlled by ai2html-settings in the document" : undefined}>
      {#each options as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </div>
</div>
