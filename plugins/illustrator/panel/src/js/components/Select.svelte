<script lang="ts">
  import type { PanelSettingKey } from "../../shared/types";
  import FieldHelp from "./FieldHelp.svelte";
  import type { SettingHelpEntry } from "../setting-help.js";

  interface Props {
    label: string;
    value: string;
    options: Array<{ value: string; label: string }>;
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
    options,
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
    <select bind:value onchange={onchange} {disabled} title={locked ? "Controlled by ai2html-settings in the document" : undefined}>
      {#each options as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  {/snippet}
</FieldHelp>
