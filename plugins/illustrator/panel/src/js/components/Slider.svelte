<script lang="ts">
  import type { PanelSettingKey } from "../../shared/types";
  import FieldHelp from "./FieldHelp.svelte";
  import type { SettingHelpEntry } from "../setting-help.js";

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
    helpId?: PanelSettingKey;
    help?: SettingHelpEntry;
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
    helpId,
    help,
  }: Props = $props();
</script>

<FieldHelp {label} {locked} {badge} {badgeTitle} {helpId} {help}>
  {#snippet children()}
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
  {/snippet}
</FieldHelp>
