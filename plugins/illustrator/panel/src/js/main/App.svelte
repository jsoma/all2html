<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { startWatching, stopWatching } from "../document-watcher";
  import {
    resolveSettings,
    saveAppDefaults,
    type ResolvedSettings,
  } from "../persistence";
  import PanelShell from "../components/PanelShell.svelte";
  import { getEditedKeys, type FieldSources } from "../provenance";
  import { panelToExporterSettings } from "../adapter";
  import { getMissingFonts, saveXmpSettings, runExport } from "../bridge";
  import { reloadWatchedHostState, runPanelTask } from "../panel-controller";
  import type {
    PanelSettings,
    PanelSettingKey,
    FontEntry,
    RunResult,
    DocumentInfo,
    XmpData,
  } from "../../shared/types";

  import RunButton from "../sections/RunButton.svelte";
  import MainSettings from "../sections/MainSettings.svelte";
  import ImageSettings from "../sections/ImageSettings.svelte";
  import OutputSettings from "../sections/OutputSettings.svelte";
  import AdvancedSettings from "../sections/AdvancedSettings.svelte";
  import FontMapper from "../sections/FontMapper.svelte";
  import DiagnosticsPanel from "../sections/DiagnosticsPanel.svelte";

  import "../styles/panel.css";

  let settings = $state<PanelSettings>({});
  let fonts = $state<FontEntry[]>([]);
  let docInfo = $state<DocumentInfo | null>(null);
  let lastResult = $state<RunResult | null>(null);
  let isRunning = $state(false);
  let settingsSource = $state<ResolvedSettings["source"]>("core-defaults");
  let documentControlledKeys = $state<PanelSettingKey[]>([]);
  let fieldSources = $state<FieldSources>({});
  let inheritedSettings = $state<PanelSettings>({});
  let dirty = $state(false);

  const SCHEMA_VERSION = "1.0.0";

  async function onDocumentChange(
    doc: DocumentInfo | null,
  ): Promise<void> {
    await reloadWatchedHostState(doc, {
      setInfo: (info) => {
        docInfo = info;
      },
      clearResult: () => {
        lastResult = null;
      },
      onPresent: async () => {
        const resolved = await resolveSettings();
        settings = resolved.settings;
        inheritedSettings = { ...resolved.settings };
        fonts = resolved.fonts;
        settingsSource = resolved.source;
        documentControlledKeys = resolved.documentControlledKeys;
        fieldSources = resolved.fieldSources;
        dirty = false;
      },
      onAbsent: () => {
        settings = {};
        inheritedSettings = {};
        fonts = [];
        settingsSource = "core-defaults";
        documentControlledKeys = [];
        fieldSources = {};
        dirty = false;
      },
    });
  }

  function editableSettings(input: PanelSettings): PanelSettings {
    const filtered = {} as PanelSettings;
    for (const [key, value] of Object.entries(input) as [
      PanelSettingKey,
      PanelSettings[PanelSettingKey],
    ][]) {
      if (!documentControlledKeys.includes(key) && value !== undefined) {
        (
          filtered as Record<PanelSettingKey, PanelSettings[PanelSettingKey] | undefined>
        )[key] = value;
      }
    }
    return filtered;
  }

  async function handleRun(): Promise<void> {
    if (!docInfo) return;

    await runPanelTask<RunResult>({
      isRunning,
      setRunning: (running) => {
        isRunning = running;
      },
      setResult: (result) => {
        lastResult = result;
      },
      beforeRun: async () => {
        const xmpData: XmpData = {
          version: SCHEMA_VERSION,
          settings: editableSettings(settings),
          fonts,
          lastSaved: new Date().toISOString(),
        };
        await saveXmpSettings(JSON.stringify(xmpData));
      },
      run: async () => {
        const exporterSettings = panelToExporterSettings(settings);
        return runExport(
          JSON.stringify(exporterSettings),
          JSON.stringify(fonts),
        );
      },
      afterSuccess: () => {
        dirty = false;
      },
      mapError: (error) => ({ success: false, error: String(error) }),
    });
  }

  function markDirty(): void {
    dirty = true;
  }

  async function handleSaveAsDefault(): Promise<void> {
    saveAppDefaults(editableSettings(settings), fonts);
  }

  const lockedCount = $derived(documentControlledKeys.length);
  const editedKeys = $derived(getEditedKeys(settings, inheritedSettings, documentControlledKeys));
  const editedCount = $derived(editedKeys.length);

  const sourceLabel = $derived.by(() => {
    if (settingsSource === "core-defaults" && documentControlledKeys.length > 0) {
      return "doc + defaults";
    }
    switch (settingsSource) {
      case "document": return "doc XMP";
      case "document-xmp": return "doc XMP";
      case "config-file": return "config file";
      case "app-defaults": return "defaults";
      case "core-defaults": return "defaults";
      case "mixed": return "mixed";
    }
  });

  const sourceDetail = $derived.by(() => {
    const labels = new Set<string>();
    for (const source of Object.values(fieldSources)) {
      if (!source || source === "text-block" || source === "core-defaults") continue;
      if (source === "document-xmp") labels.add("xmp");
      else if (source === "config-file") labels.add("config");
      else if (source === "app-defaults") labels.add("defaults");
    }
    return Array.from(labels).sort().join(" + ");
  });

  onMount(() => {
    startWatching(onDocumentChange);
  });

  onDestroy(() => {
    stopWatching();
  });
</script>

<PanelShell
  active={!!docInfo}
  title={docInfo?.name}
  emptyMessage="Open an Illustrator document to get started."
>
  {#snippet body()}
    {#if docInfo}
      {#if lockedCount > 0}
        <div class="panel-note panel-note-warning">
          {lockedCount} setting{lockedCount !== 1 ? "s are" : " is"} controlled by
          <code>ai2html-settings</code> in this document. Those fields are shown as locked here.
        </div>
      {/if}

      <MainSettings bind:settings onchange={markDirty} {documentControlledKeys} {fieldSources} {editedKeys} />
      <ImageSettings bind:settings onchange={markDirty} {documentControlledKeys} {fieldSources} {editedKeys} />
      <OutputSettings bind:settings onchange={markDirty} {documentControlledKeys} {fieldSources} {editedKeys} />

      <FontMapper bind:fonts onchange={markDirty} ondetectmissing={getMissingFonts} />
      <AdvancedSettings bind:settings onchange={markDirty} {documentControlledKeys} {fieldSources} {editedKeys} />

      <div class="section" style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px">
        <button class="btn-secondary" onclick={handleSaveAsDefault}>
          Save as Default
        </button>
        <span class="settings-source">
          src: {sourceLabel}
          {#if settingsSource === "mixed" && sourceDetail}
            <span> ({sourceDetail})</span>
          {/if}
          {#if lockedCount > 0}
            <span> | {lockedCount} doc-locked</span>
          {/if}
          {#if editedCount > 0}
            <span> | {editedCount} edited</span>
          {/if}
          {#if dirty}
            <span style="color: var(--warning)"> (modified)</span>
          {/if}
        </span>
      </div>
    {/if}
  {/snippet}

  {#snippet footer()}
    {#if docInfo}
      <RunButton {isRunning} result={lastResult} onrun={handleRun} />
      {#if lastResult}
        <DiagnosticsPanel result={lastResult} />
      {/if}
    {/if}
  {/snippet}
</PanelShell>
