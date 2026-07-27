<script lang="ts">
  import type { PanelSettingKey, PanelSettings } from "../../shared/types";
  import Select from "../components/Select.svelte";
  import {
    getFieldBadge,
    getFieldBadgeTitle,
    type EditedKeys,
    type FieldSources,
  } from "../provenance";
  import { getSettingHelp } from "../setting-help.js";
  import { capabilityNote, gateOptions, isControlDisabledByCapability } from "../capability.js";

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

  // Bind helpers: ensure settings keys exist with defaults for the controls
  let responsiveness = $derived(settings.responsiveness ?? "fixed");
  let renderTextAs = $derived(settings.renderTextAs ?? "html");
  let output = $derived(settings.output ?? "one-file");

  function isLocked(key: PanelSettingKey): boolean {
    return documentControlledKeys.includes(key);
  }

  function badgeFor(key: PanelSettingKey): string {
    return getFieldBadge(fieldSources, key, isLocked(key), editedKeys.includes(key));
  }

  function badgeTitleFor(key: PanelSettingKey): string | undefined {
    return getFieldBadgeTitle(fieldSources, key, isLocked(key), editedKeys.includes(key));
  }

  function helpFor(key: PanelSettingKey) {
    return getSettingHelp(key);
  }

  const outputOptions = gateOptions("output", [
    { value: "one-file", label: "Single file" },
    { value: "multiple-files", label: "Per artboard" },
  ]);
</script>

<div class="section">
  <div class="section-label">Layout</div>

  <Select
    label="Layout"
    bind:value={
      () => responsiveness,
      (v) => { settings.responsiveness = v as "fixed" | "dynamic"; onchange(); }
    }
    options={[
      { value: "fixed", label: "Fixed" },
      { value: "dynamic", label: "Dynamic" },
    ]}
    disabled={isLocked("responsiveness")}
    locked={isLocked("responsiveness")}
    badge={badgeFor("responsiveness")}
    badgeTitle={badgeTitleFor("responsiveness")}
    helpId="responsiveness"
    help={helpFor("responsiveness")}
    {onchange}
  />

  <Select
    label="Text as"
    bind:value={
      () => renderTextAs,
      (v) => { settings.renderTextAs = v as "html" | "image"; onchange(); }
    }
    options={[
      { value: "html", label: "HTML" },
      { value: "image", label: "Image" },
    ]}
    disabled={isLocked("renderTextAs")}
    locked={isLocked("renderTextAs")}
    badge={badgeFor("renderTextAs")}
    badgeTitle={badgeTitleFor("renderTextAs")}
    helpId="renderTextAs"
    help={helpFor("renderTextAs")}
    {onchange}
  />

  <Select
    label="Output"
    bind:value={
      () => output,
      (v) => { settings.output = v as "one-file" | "multiple-files"; onchange(); }
    }
    options={outputOptions}
    disabled={isLocked("output") || isControlDisabledByCapability("output")}
    locked={isLocked("output")}
    badge={badgeFor("output")}
    badgeTitle={badgeTitleFor("output")}
    helpId="output"
    help={helpFor("output")}
    note={capabilityNote("output")}
    {onchange}
  />
</div>
