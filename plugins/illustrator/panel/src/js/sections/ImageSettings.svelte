<script lang="ts">
  import type { PanelSettingKey, PanelSettings } from "../../shared/types";
  import Select from "../components/Select.svelte";
  import Slider from "../components/Slider.svelte";
  import Checkbox from "../components/Checkbox.svelte";
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

  let imageFormat = $derived(settings.imageFormat ?? "auto");
  let jpgQuality = $derived(settings.jpgQuality ?? 85);
  let pngNumberOfColors = $derived(settings.pngNumberOfColors ?? 128);
  let use2xImages = $derived(settings.use2xImages ?? true);

  const showJpg = $derived(imageFormat === "jpg" || imageFormat === "auto");
  const showPng = $derived(
    imageFormat === "png" || imageFormat === "png24" || imageFormat === "auto",
  );

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

  // Illustrator rasterizes 8-bit PNG for everything but jpg, so png24 and svg
  // are shown disabled rather than removed — a stored value still displays.
  const imageFormatOptions = gateOptions("imageFormat", [
    { value: "auto", label: "Auto" },
    { value: "png", label: "PNG (8-bit)" },
    { value: "png24", label: "PNG (24-bit)" },
    { value: "jpg", label: "JPEG" },
    { value: "svg", label: "SVG" },
  ]);
</script>

<div class="section">
  <div class="section-label">Images</div>

  <Select
    label="Format"
    bind:value={
      () => imageFormat,
      (v) => { settings.imageFormat = v as PanelSettings["imageFormat"]; onchange(); }
    }
    options={imageFormatOptions}
    disabled={isLocked("imageFormat") || isControlDisabledByCapability("imageFormat")}
    locked={isLocked("imageFormat")}
    badge={badgeFor("imageFormat")}
    badgeTitle={badgeTitleFor("imageFormat")}
    helpId="imageFormat"
    help={helpFor("imageFormat")}
    note={capabilityNote("imageFormat")}
    {onchange}
  />

  {#if showJpg}
    <Slider
      label="JPG quality"
      bind:value={
        () => jpgQuality,
        (v) => { settings.jpgQuality = v; onchange(); }
      }
      min={0}
      max={100}
      suffix="%"
      disabled={isLocked("jpgQuality")}
      locked={isLocked("jpgQuality")}
      badge={badgeFor("jpgQuality")}
      badgeTitle={badgeTitleFor("jpgQuality")}
      {onchange}
    />
  {/if}

  {#if showPng}
    <Slider
      label="PNG colors"
      bind:value={
        () => pngNumberOfColors,
        (v) => { settings.pngNumberOfColors = v; onchange(); }
      }
      min={1}
      max={256}
      disabled={isLocked("pngNumberOfColors")}
      locked={isLocked("pngNumberOfColors")}
      badge={badgeFor("pngNumberOfColors")}
      badgeTitle={badgeTitleFor("pngNumberOfColors")}
      {onchange}
    />
  {/if}

  <Checkbox
    label="Retina (2x) images"
    bind:checked={
      () => use2xImages,
      (v) => { settings.use2xImages = v; onchange(); }
    }
    disabled={isLocked("use2xImages")}
    locked={isLocked("use2xImages")}
    badge={badgeFor("use2xImages")}
    badgeTitle={badgeTitleFor("use2xImages")}
    helpId="use2xImages"
    help={helpFor("use2xImages")}
    {onchange}
  />
</div>
