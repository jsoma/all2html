<script lang="ts">
  import type { PanelSettingKey, PanelSettings } from "../../shared/types";
  import TextInput from "../components/TextInput.svelte";
  import {
    getFieldBadge,
    getFieldBadgeTitle,
    type EditedKeys,
    type FieldSources,
  } from "../provenance";

  interface Props {
    settings: PanelSettings;
    onchange: () => void;
    documentControlledKeys?: PanelSettingKey[];
    fieldSources?: FieldSources;
    editedKeys?: EditedKeys;
  }

  let {
    settings = $bindable(),
    onchange,
    documentControlledKeys = [],
    fieldSources = {},
    editedKeys = [],
  }: Props = $props();

  let htmlOutputPath = $derived(settings.htmlOutputPath ?? "all2html-output/");
  let imageOutputPath = $derived(settings.imageOutputPath ?? "all2html-output/");

  function isLocked(key: PanelSettingKey): boolean {
    return documentControlledKeys.includes(key);
  }

  function badgeFor(key: PanelSettingKey): string {
    return getFieldBadge(fieldSources, key, isLocked(key), editedKeys.includes(key));
  }

  function badgeTitleFor(key: PanelSettingKey): string | undefined {
    return getFieldBadgeTitle(fieldSources, key, isLocked(key), editedKeys.includes(key));
  }
</script>

<div class="section">
  <div class="section-label">Output</div>

  <TextInput
    label="HTML path"
    bind:value={
      () => htmlOutputPath,
      (v) => { settings.htmlOutputPath = v; onchange(); }
    }
    placeholder="all2html-output/"
    disabled={isLocked("htmlOutputPath")}
    locked={isLocked("htmlOutputPath")}
    badge={badgeFor("htmlOutputPath")}
    badgeTitle={badgeTitleFor("htmlOutputPath")}
    {onchange}
  />

  <TextInput
    label="Image path"
    bind:value={
      () => imageOutputPath,
      (v) => { settings.imageOutputPath = v; onchange(); }
    }
    placeholder="all2html-output/"
    disabled={isLocked("imageOutputPath")}
    locked={isLocked("imageOutputPath")}
    badge={badgeFor("imageOutputPath")}
    badgeTitle={badgeTitleFor("imageOutputPath")}
    {onchange}
  />
</div>
