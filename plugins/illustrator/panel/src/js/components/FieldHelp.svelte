<script lang="ts">
  import type { Snippet } from "svelte";
  import { openUrl } from "../lib/utils/bolt.js";
  import {
    buildSettingHelpDocsUrl,
    closeOpenSettingHelp,
    openSettingHelpId,
    toggleOpenSettingHelp,
    type SettingHelpEntry,
  } from "../setting-help.js";

  interface Props {
    label: string;
    helpId?: string;
    help?: SettingHelpEntry;
    locked?: boolean;
    badge?: string;
    badgeTitle?: string;
    checkbox?: boolean;
    wrapperTitle?: string;
    children: Snippet;
  }

  let {
    label,
    helpId,
    help,
    locked = false,
    badge = "",
    badgeTitle,
    checkbox = false,
    wrapperTitle,
    children,
  }: Props = $props();

  const isOpen = $derived.by(
    () => !!help && !!helpId && $openSettingHelpId === helpId,
  );
  const docsUrl = $derived.by(() =>
    help ? buildSettingHelpDocsUrl(help.docsAnchor) : null,
  );
  const optionNotes = $derived.by(() =>
    help?.optionNotes ? Object.entries(help.optionNotes) : [],
  );

  function handleToggle(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!helpId) return;
    toggleOpenSettingHelp(helpId);
  }

  function handleLearnMore(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!docsUrl) return;
    openUrl(docsUrl);
    closeOpenSettingHelp();
  }

  function handleDocumentMouseDown(event: MouseEvent): void {
    if (!isOpen || !helpId) return;
    const target = event.target;
    const owner =
      target instanceof Element
        ? target.closest(`[data-field-help-id="${helpId}"]`)
        : null;
    if (!owner) {
      closeOpenSettingHelp();
    }
  }

  function handleDocumentKeyDown(event: KeyboardEvent): void {
    if (!isOpen) return;
    if (event.key === "Escape") {
      closeOpenSettingHelp();
    }
  }
</script>

<svelte:document
  onmousedown={handleDocumentMouseDown}
  onkeydown={handleDocumentKeyDown}
/>

<div class="field-stack" data-field-help-id={helpId || undefined}>
  <div class="field" class:field-locked={locked} class:field-checkbox={checkbox}>
    {#if checkbox}
      <label class="checkbox-wrapper" title={wrapperTitle}>
        {@render children()}
        <span class="field-label field-label-checkbox">
          <span class="field-label-row">
            <span>{label}</span>
            {#if help && helpId}
              <button
                class="field-help-button"
                type="button"
                aria-expanded={isOpen}
                aria-controls={`field-help-card-${helpId}`}
                aria-label={`Explain ${label}`}
                onclick={handleToggle}
              >
                ?
              </button>
            {/if}
            {#if badge}
              <span class="field-badge" title={badgeTitle}>{badge}</span>
            {/if}
          </span>
        </span>
      </label>
    {:else}
      <span class="field-label">
        <span class="field-label-row">
          <span>{label}</span>
          {#if help && helpId}
            <button
              class="field-help-button"
              type="button"
              aria-expanded={isOpen}
              aria-controls={`field-help-card-${helpId}`}
              aria-label={`Explain ${label}`}
              onclick={handleToggle}
            >
              ?
            </button>
          {/if}
          {#if badge}
            <span class="field-badge" title={badgeTitle}>{badge}</span>
          {/if}
        </span>
      </span>
      <div class="field-control">
        {@render children()}
      </div>
    {/if}
  </div>

  {#if isOpen && help && helpId}
    <div class="field-help-card" id={`field-help-card-${helpId}`}>
      <p class="field-help-summary">{help.summary}</p>

      {#if help.details}
        <p class="field-help-details">{help.details}</p>
      {/if}

      {#if optionNotes.length > 0}
        <div class="field-help-options">
          <div class="field-help-subtitle">Choices</div>
          {#each optionNotes as [optionLabel, optionNote]}
            <div class="field-help-option">
              <strong>{optionLabel}:</strong> {optionNote}
            </div>
          {/each}
        </div>
      {/if}

      {#if help.defaultNote}
        <p class="field-help-default">
          <strong>Usually:</strong> {help.defaultNote}
        </p>
      {/if}

      {#if docsUrl}
        <div class="field-help-actions">
          <button class="field-help-link" type="button" onclick={handleLearnMore}>
            Learn more
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>
