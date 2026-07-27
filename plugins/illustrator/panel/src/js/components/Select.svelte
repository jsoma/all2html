<script lang="ts">
  import type { PanelSettingKey } from "../../shared/types";
  import FieldHelp from "./FieldHelp.svelte";
  import type { SettingHelpEntry } from "../setting-help.js";

  interface Props {
    label: string;
    value: string;
    options: Array<{ value: string; label: string; disabled?: boolean }>;
    onchange?: () => void;
    disabled?: boolean;
    locked?: boolean;
    badge?: string;
    badgeTitle?: string;
    helpId?: PanelSettingKey;
    help?: SettingHelpEntry;
    note?: string;
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
    note,
  }: Props = $props();

  const title = $derived(
    locked ? "Controlled by ai2html-settings in the document" : note || undefined,
  );
</script>

<FieldHelp {label} {locked} {badge} {badgeTitle} {helpId} {help} {note}>
  {#snippet children()}
    <select bind:value onchange={onchange} {disabled} {title}>
      {#each options as opt}
        <option value={opt.value} disabled={opt.disabled}>{opt.label}</option>
      {/each}
    </select>
  {/snippet}
</FieldHelp>
