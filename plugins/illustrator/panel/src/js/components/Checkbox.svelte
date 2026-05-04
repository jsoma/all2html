<script lang="ts">
  import type { PanelSettingKey } from "../../shared/types";
  import FieldHelp from "./FieldHelp.svelte";
  import type { SettingHelpEntry } from "../setting-help.js";

  interface Props {
    label: string;
    checked: boolean;
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
    checked = $bindable(),
    onchange,
    disabled = false,
    locked = false,
    badge = "",
    badgeTitle,
    helpId,
    help,
  }: Props = $props();
</script>

<FieldHelp
  {label}
  {locked}
  {badge}
  {badgeTitle}
  {helpId}
  {help}
  checkbox={true}
  wrapperTitle={locked ? "Controlled by ai2html-settings in the document" : undefined}
>
  {#snippet children()}
    <input type="checkbox" bind:checked onchange={onchange} {disabled} />
  {/snippet}
</FieldHelp>
