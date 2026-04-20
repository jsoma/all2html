<script lang="ts">
  interface Props {
    label: string;
    value: string;
    placeholder?: string;
    onchange?: () => void;
    disabled?: boolean;
    locked?: boolean;
    badge?: string;
    badgeTitle?: string;
  }

  let {
    label,
    value = $bindable(),
    placeholder = "",
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
    <input
      type="text"
      bind:value
      {placeholder}
      onchange={onchange}
      {disabled}
      title={locked ? "Controlled by ai2html-settings in the document" : undefined}
    />
  </div>
</div>
