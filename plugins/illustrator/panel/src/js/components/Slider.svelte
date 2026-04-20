<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    suffix?: string;
    onchange?: () => void;
    disabled?: boolean;
    locked?: boolean;
    badge?: string;
    badgeTitle?: string;
  }

  let {
    label,
    value = $bindable(),
    min,
    max,
    step = 1,
    suffix = "",
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
    <div class="slider-wrapper">
      <input
        type="range"
        bind:value
        {min}
        {max}
        {step}
        oninput={onchange}
        {disabled}
        title={locked ? "Controlled by ai2html-settings in the document" : undefined}
      />
      <span class="slider-value">{value}{suffix}</span>
    </div>
  </div>
</div>
