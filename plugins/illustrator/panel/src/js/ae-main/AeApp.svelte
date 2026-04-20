<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    getAeMissingFonts,
    getAeOutputTemplates,
    listAeComps,
    openFolder,
    runAeExport,
    saveAeConfigFile,
  } from "../ae-bridge";
  import { resolveAeState, saveAeAppDefaults } from "../ae-persistence";
  import { startAeWatching, stopAeWatching } from "../ae-document-watcher";
  import Collapsible from "../components/Collapsible.svelte";
  import PanelShell from "../components/PanelShell.svelte";
  import RunResultRow from "../components/RunResult.svelte";
  import FontMapper from "../sections/FontMapper.svelte";
  import DiagnosticsPanel from "../sections/DiagnosticsPanel.svelte";
  import {
    openResultFolder,
    reloadWatchedHostState,
    runPanelTask,
  } from "../panel-controller";
  import type {
    AeCompInfo,
    AeConfigData,
    AePanelSettings,
    AeProjectInfo,
    AeRunResult,
    FontEntry,
  } from "../../shared/types";
  import "../styles/panel.css";

  const IMAGE_TEMPLATE_RE = /(png|jpeg|jpg|tiff|tif|photoshop|psd|sequence)/i;
  const SCHEMA_VERSION = "1.0.0";

  let projectInfo = $state<AeProjectInfo | null>(null);
  let comps = $state<AeCompInfo[]>([]);
  let settings = $state<AePanelSettings>({
    overlayPrefix: "overlay:",
    outputRoot: "",
    videoTemplate: "",
    posterTemplate: "",
  });
  let fonts = $state<FontEntry[]>([]);
  let lastResult = $state<AeRunResult | null>(null);
  let isRunning = $state(false);
  let detailsOpen = $state(false);
  let outputTemplates = $state<string[]>([]);
  let canQueueInAME = $state(false);
  let templateLoadError = $state("");
  let templateLoadGeneration = 0;

  function emptyToUndefined(value: string | null | undefined): string | undefined {
    const trimmed = String(value || "").trim();
    return trimmed || undefined;
  }

  function buildPersistedSettings(includeTargetCompId: boolean): AePanelSettings {
    return {
      overlayPrefix: emptyToUndefined(settings.overlayPrefix) || "overlay:",
      targetCompId: includeTargetCompId ? settings.targetCompId || null : undefined,
      outputRoot: emptyToUndefined(settings.outputRoot),
      videoTemplate: emptyToUndefined(settings.videoTemplate),
      posterTemplate: emptyToUndefined(settings.posterTemplate),
    };
  }

  async function refreshTemplates(compId: string | null): Promise<void> {
    const generation = ++templateLoadGeneration;
    templateLoadError = "";

    try {
      const catalog = await getAeOutputTemplates(compId);
      if (generation !== templateLoadGeneration) return;
      outputTemplates = [...(catalog.outputModuleTemplates || [])];
      canQueueInAME = !!catalog.canQueueInAME;
    } catch (e) {
      if (generation !== templateLoadGeneration) return;
      outputTemplates = [];
      canQueueInAME = false;
      templateLoadError = String(e);
    }
  }

  async function reloadPanelState(info: AeProjectInfo | null): Promise<void> {
    await reloadWatchedHostState(info, {
      setInfo: (nextInfo) => {
        projectInfo = nextInfo;
      },
      clearResult: () => {
        lastResult = null;
        detailsOpen = false;
      },
      onPresent: async (nextInfo) => {
        const [resolved, listedComps] = await Promise.all([resolveAeState(), listAeComps()]);
        comps = listedComps;
        fonts = resolved.fonts;

        const selectedCompId =
          resolved.settings.targetCompId &&
          listedComps.some((comp) => comp.id === resolved.settings.targetCompId)
            ? resolved.settings.targetCompId
            : nextInfo.activeCompId || (listedComps[0] ? listedComps[0].id : null);

        settings = {
          overlayPrefix: resolved.settings.overlayPrefix || "overlay:",
          targetCompId: selectedCompId,
          outputRoot: resolved.settings.outputRoot || "",
          videoTemplate: resolved.settings.videoTemplate || "",
          posterTemplate: resolved.settings.posterTemplate || "",
        };

        await refreshTemplates(selectedCompId);
      },
      onAbsent: () => {
        comps = [];
        settings = {
          overlayPrefix: "overlay:",
          outputRoot: "",
          videoTemplate: "",
          posterTemplate: "",
        };
        fonts = [];
        outputTemplates = [];
        canQueueInAME = false;
        templateLoadError = "";
      },
    });
  }

  async function detectMissingFonts(currentFonts: FontEntry[]): Promise<string[]> {
    return getAeMissingFonts(currentFonts, settings.targetCompId ?? null);
  }

  function handleCompChange(): void {
    void refreshTemplates(settings.targetCompId ?? null);
  }

  async function persistProjectConfig(): Promise<void> {
    const config: AeConfigData = {
      version: SCHEMA_VERSION,
      settings: buildPersistedSettings(true),
      fonts,
    };
    await saveAeConfigFile(JSON.stringify(config, null, 2));
  }

  async function handleRun(): Promise<void> {
    if (!projectInfo?.saved || !settings.targetCompId) return;

    await runPanelTask<AeRunResult>({
      isRunning,
      setRunning: (running) => {
        isRunning = running;
      },
      setResult: (result) => {
        lastResult = result;
      },
      beforeRun: async () => {
        detailsOpen = false;
        await persistProjectConfig();
      },
      run: async () =>
        runAeExport(
          JSON.stringify(buildPersistedSettings(true)),
          JSON.stringify(fonts),
        ),
      mapError: (error) => ({
        success: false,
        error: String(error),
      }),
    });
  }

  function handleSaveAsDefault(): void {
    saveAeAppDefaults(buildPersistedSettings(false), fonts);
  }

  function handleOpenFolder(): void {
    openResultFolder(lastResult?.outputPath, openFolder);
  }

  function buildTemplateOptions(selected: string | undefined, options: string[]): string[] {
    const normalized = emptyToUndefined(selected);
    if (!normalized) return options;
    return options.includes(normalized) ? options : [normalized, ...options];
  }

  const activeCompLabel = $derived.by(() => {
    const comp = comps.find((entry) => entry.id === settings.targetCompId);
    if (!comp) return "No comp selected";
    return `${comp.name} · ${comp.width}×${comp.height} · ${comp.frameRate} fps`;
  });

  const suggestedVideoTemplates = $derived.by(() => {
    const filtered = outputTemplates.filter((template) => !IMAGE_TEMPLATE_RE.test(template));
    return filtered.length > 0 ? filtered : outputTemplates;
  });

  const suggestedPosterTemplates = $derived.by(() => {
    const filtered = outputTemplates.filter((template) => IMAGE_TEMPLATE_RE.test(template));
    return filtered.length > 0 ? filtered : outputTemplates;
  });

  const videoTemplateOptions = $derived.by(() =>
    buildTemplateOptions(settings.videoTemplate, suggestedVideoTemplates),
  );

  const posterTemplateOptions = $derived.by(() =>
    buildTemplateOptions(settings.posterTemplate, suggestedPosterTemplates),
  );

  const videoTemplateMissing = $derived.by(() => {
    const selected = emptyToUndefined(settings.videoTemplate);
    return !!selected && !outputTemplates.includes(selected);
  });

  const posterTemplateMissing = $derived.by(() => {
    const selected = emptyToUndefined(settings.posterTemplate);
    return !!selected && !outputTemplates.includes(selected);
  });

  const runSummary = $derived.by(() => {
    if (!lastResult?.success) return "";
    const verb = lastResult.videoMode === "ame" ? "Queued video to AME" : "Rendered video locally";
    const overlays = `${lastResult.overlayCount ?? 0} overlay${lastResult.overlayCount === 1 ? "" : "s"}`;
    return lastResult.elapsed ? `${verb} · ${overlays} · ${lastResult.elapsed}` : `${verb} · ${overlays}`;
  });

  const posterSummary = $derived.by(() => {
    if (!lastResult?.success) return "";
    if (lastResult.posterRendered) {
      return lastResult.posterTemplate
        ? `Rendered via ${lastResult.posterTemplate}`
        : "Rendered via auto-detected template";
    }
    if (lastResult.posterError) {
      return lastResult.posterError;
    }
    return "Skipped";
  });

  onMount(() => {
    startAeWatching(reloadPanelState);
  });

  onDestroy(() => {
    stopAeWatching();
  });
</script>

<PanelShell
  active={!!projectInfo}
  title={projectInfo?.name}
  emptyMessage="Open an After Effects project to get started."
>
  {#snippet body()}
    {#if projectInfo}
      {#if !projectInfo.saved}
        <div class="panel-note panel-note-warning">
          Save the project before exporting. The AE panel stores font mappings in
          <code>all2html-ae.config.json</code> next to the <code>.aep</code>.
        </div>
      {/if}

      <div class="section">
        <div class="section-label">Composition</div>
        <div class="field">
          <label class="field-label" for="ae-comp-select">Comp</label>
          <div class="field-control">
            <select
              id="ae-comp-select"
              bind:value={settings.targetCompId}
              onchange={handleCompChange}
            >
              {#each comps as comp}
                <option value={comp.id}>{comp.name}</option>
              {/each}
            </select>
          </div>
        </div>
        <div class="panel-note" style="margin-top: 6px">
          {activeCompLabel}
        </div>
      </div>

      <div class="section">
        <div class="section-label">Export</div>
        <div class="field">
          <label class="field-label" for="overlay-prefix">Overlay Prefix</label>
          <div class="field-control">
            <input
              id="overlay-prefix"
              type="text"
              bind:value={settings.overlayPrefix}
            />
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="output-root">Output Root</label>
          <div class="field-control" style="max-width: none">
            <input
              id="output-root"
              type="text"
              bind:value={settings.outputRoot}
              placeholder="all2html-ae-output"
            />
          </div>
        </div>
        <div class="panel-note" style="margin-top: 6px">
          Leave blank to write next to the project. Relative paths resolve from the saved
          project folder.
        </div>
      </div>

      <div class="section">
        <div class="section-label">Templates</div>
        <div class="field">
          <label class="field-label" for="video-template">Video</label>
          <div class="field-control" style="max-width: none">
            <select
              id="video-template"
              bind:value={settings.videoTemplate}
            >
              <option value="">Auto detect / AME fallback</option>
              {#each videoTemplateOptions as template}
                <option value={template}>
                  {template}{videoTemplateMissing && settings.videoTemplate === template ? " (unavailable)" : ""}
                </option>
              {/each}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="poster-template">Poster</label>
          <div class="field-control" style="max-width: none">
            <select
              id="poster-template"
              bind:value={settings.posterTemplate}
            >
              <option value="">Auto detect</option>
              {#each posterTemplateOptions as template}
                <option value={template}>
                  {template}{posterTemplateMissing && settings.posterTemplate === template ? " (unavailable)" : ""}
                </option>
              {/each}
            </select>
          </div>
        </div>

        {#if templateLoadError}
          <div class="panel-note panel-note-warning" style="margin-top: 6px">
            Could not load output-module templates: {templateLoadError}
          </div>
        {:else if outputTemplates.length === 0}
          <div class="panel-note" style="margin-top: 6px">
            No output-module templates detected for the selected comp.
            {#if canQueueInAME}
              Video export can still queue to Adobe Media Encoder.
            {/if}
          </div>
        {:else}
          <div class="panel-note" style="margin-top: 6px">
            {outputTemplates.length} output-module template{outputTemplates.length === 1 ? "" : "s"}
            detected.
            {#if canQueueInAME}
              AME queue is available if no local video template matches.
            {/if}
          </div>
        {/if}
      </div>

      <FontMapper
        bind:fonts
        ondetectmissing={detectMissingFonts}
        sourceLabel="AE Font"
      />

      <div class="section">
        <button class="btn-secondary" onclick={handleSaveAsDefault}>Save as Default</button>
      </div>
    {/if}
  {/snippet}

  {#snippet footer()}
    {#if projectInfo}
      <div class="section">
        <button
          class="btn-primary"
          disabled={isRunning || !projectInfo.saved || !settings.targetCompId}
          onclick={handleRun}
        >
          {#if isRunning}
            <span class="spinner"></span> Exporting...
          {:else}
            Export selected comp
          {/if}
        </button>

        {#if lastResult}
          {#if lastResult.success}
            <RunResultRow
              success={true}
              message={runSummary}
              outputPath={lastResult.outputPath}
              onopenfolder={handleOpenFolder}
            />
            <Collapsible title="Details" bind:open={detailsOpen}>
              <div class="panel-note" style="margin-top: 2px; margin-bottom: 0">
                <div><strong>Comp:</strong> {lastResult.compName || activeCompLabel}</div>
                <div>
                  <strong>Video:</strong>
                  {#if lastResult.videoMode === "ame"}
                    Queued to Adobe Media Encoder
                  {:else}
                    Rendered in After Effects
                  {/if}
                  {#if lastResult.videoTemplate}
                    via <code>{lastResult.videoTemplate}</code>
                  {/if}
                </div>
                <div>
                  <strong>Poster:</strong>
                  {posterSummary}
                </div>
                {#if lastResult.outputPath}
                  <div style="margin-top: 6px">
                    <strong>Output</strong>
                    <code class="diagnostic-path">{lastResult.outputPath}</code>
                  </div>
                {/if}
                {#if lastResult.summaryPath}
                  <div>
                    <strong>Summary</strong>
                    <code class="diagnostic-path">{lastResult.summaryPath}</code>
                  </div>
                {/if}
                {#if lastResult.htmlPath}
                  <div>
                    <strong>HTML</strong>
                    <code class="diagnostic-path">{lastResult.htmlPath}</code>
                  </div>
                {/if}
                {#if lastResult.jsonPath}
                  <div>
                    <strong>JSON</strong>
                    <code class="diagnostic-path">{lastResult.jsonPath}</code>
                  </div>
                {/if}
                {#if lastResult.videoPath}
                  <div>
                    <strong>Video</strong>
                    <code class="diagnostic-path">{lastResult.videoPath}</code>
                  </div>
                {/if}
                {#if lastResult.posterPath}
                  <div>
                    <strong>Poster</strong>
                    <code class="diagnostic-path">{lastResult.posterPath}</code>
                  </div>
                {/if}
              </div>
            </Collapsible>
          {:else}
            <RunResultRow success={false} message={lastResult.error || "Export failed"} />
            <div class="panel-note panel-note-warning" style="margin-top: 6px">
              {lastResult.error || "Export failed"}
            </div>
          {/if}
          <DiagnosticsPanel result={lastResult} />
        {/if}
      </div>
    {/if}
  {/snippet}
</PanelShell>
