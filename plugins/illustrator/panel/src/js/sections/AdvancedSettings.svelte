<script lang="ts">
  import type { PanelSettingKey, PanelSettings } from "../../shared/types";
  import Collapsible from "../components/Collapsible.svelte";
  import Select from "../components/Select.svelte";
  import Checkbox from "../components/Checkbox.svelte";
  import TextInput from "../components/TextInput.svelte";
  import {
    getFieldBadge,
    getFieldBadgeTitle,
    type EditedKeys,
    type FieldSources,
  } from "../provenance";
  import { getSettingHelp } from "../setting-help.js";

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

  // Count how many advanced settings differ from defaults
  const advancedCount = $derived.by(() => {
    let count = 0;
    if (settings.namespace && settings.namespace !== "g-") count++;
    if (settings.projectName) count++;
    if (settings.htmlOutputExtension && settings.htmlOutputExtension !== ".html") count++;
    if (settings.imageSourcePath) count++;
    if (settings.textResponsiveness === "fixed") count++;
    if (settings.maxWidth) count++;
    if (settings.centerHtmlOutput === false) count++;
    if (settings.renderRotatedSkewedTextAs === "image") count++;
    if (settings.testingMode) count++;
    if (settings.includeResizerCss === false) count++;
    if (settings.includeResizerWidths === false) count++;
    if (settings.inlineSvg) count++;
    if (settings.svgIdPrefix) count++;
    if (settings.svgEmbedImages) count++;
    if (settings.pngTransparent) count++;
    if (settings.clickableLink) count++;
    if (settings.altText) count++;
    return count;
  });

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
</script>

<Collapsible
  title="Advanced"
  count={advancedCount > 0 ? `${advancedCount} changed` : "17 settings"}
>
  <div class="section-label" style="margin-top: 4px">Output</div>

  <TextInput
    label="Namespace"
    bind:value={
      () => settings.namespace ?? "g-",
      (v) => { settings.namespace = v; onchange(); }
    }
    placeholder="g-"
    disabled={isLocked("namespace")}
    locked={isLocked("namespace")}
    badge={badgeFor("namespace")}
    badgeTitle={badgeTitleFor("namespace")}
    {onchange}
  />

  <TextInput
    label="Project name"
    bind:value={
      () => settings.projectName ?? "",
      (v) => { settings.projectName = v; onchange(); }
    }
    placeholder="(from filename)"
    disabled={isLocked("projectName")}
    locked={isLocked("projectName")}
    badge={badgeFor("projectName")}
    badgeTitle={badgeTitleFor("projectName")}
    {onchange}
  />

  <TextInput
    label="Extension"
    bind:value={
      () => settings.htmlOutputExtension ?? ".html",
      (v) => { settings.htmlOutputExtension = v; onchange(); }
    }
    placeholder=".html"
    disabled={isLocked("htmlOutputExtension")}
    locked={isLocked("htmlOutputExtension")}
    badge={badgeFor("htmlOutputExtension")}
    badgeTitle={badgeTitleFor("htmlOutputExtension")}
    {onchange}
  />

  <TextInput
    label="Image src"
    bind:value={
      () => settings.imageSourcePath ?? "",
      (v) => { settings.imageSourcePath = v; onchange(); }
    }
    placeholder="(relative to HTML)"
    disabled={isLocked("imageSourcePath")}
    locked={isLocked("imageSourcePath")}
    badge={badgeFor("imageSourcePath")}
    badgeTitle={badgeTitleFor("imageSourcePath")}
    {onchange}
  />

  <div class="section-label" style="margin-top: 8px">Responsive</div>

  <Select
    label="Text sizing"
    bind:value={
      () => settings.textResponsiveness ?? "dynamic",
      (v) => { settings.textResponsiveness = v as "fixed" | "dynamic"; onchange(); }
    }
    options={[
      { value: "dynamic", label: "Dynamic" },
      { value: "fixed", label: "Fixed" },
    ]}
    disabled={isLocked("textResponsiveness")}
    locked={isLocked("textResponsiveness")}
    badge={badgeFor("textResponsiveness")}
    badgeTitle={badgeTitleFor("textResponsiveness")}
    helpId="textResponsiveness"
    help={helpFor("textResponsiveness")}
    {onchange}
  />

  <TextInput
    label="Max width"
    bind:value={
      () => settings.maxWidth != null ? String(settings.maxWidth) : "",
      (v) => { settings.maxWidth = v ? parseInt(v, 10) || null : null; onchange(); }
    }
    placeholder="(none)"
    disabled={isLocked("maxWidth")}
    locked={isLocked("maxWidth")}
    badge={badgeFor("maxWidth")}
    badgeTitle={badgeTitleFor("maxWidth")}
    {onchange}
  />

  <Checkbox
    label="Center output"
    bind:checked={
      () => settings.centerHtmlOutput ?? true,
      (v) => { settings.centerHtmlOutput = v; onchange(); }
    }
    disabled={isLocked("centerHtmlOutput")}
    locked={isLocked("centerHtmlOutput")}
    badge={badgeFor("centerHtmlOutput")}
    badgeTitle={badgeTitleFor("centerHtmlOutput")}
    {onchange}
  />

  <div class="section-label" style="margin-top: 8px">Rendering</div>

  <Select
    label="Rotated text"
    bind:value={
      () => settings.renderRotatedSkewedTextAs ?? "html",
      (v) => { settings.renderRotatedSkewedTextAs = v as "html" | "image"; onchange(); }
    }
    options={[
      { value: "html", label: "HTML" },
      { value: "image", label: "Image" },
    ]}
    disabled={isLocked("renderRotatedSkewedTextAs")}
    locked={isLocked("renderRotatedSkewedTextAs")}
    badge={badgeFor("renderRotatedSkewedTextAs")}
    badgeTitle={badgeTitleFor("renderRotatedSkewedTextAs")}
    {onchange}
  />

  <Checkbox
    label="Testing mode"
    bind:checked={
      () => settings.testingMode ?? false,
      (v) => { settings.testingMode = v; onchange(); }
    }
    disabled={isLocked("testingMode")}
    locked={isLocked("testingMode")}
    badge={badgeFor("testingMode")}
    badgeTitle={badgeTitleFor("testingMode")}
    {onchange}
  />

  <div class="section-label" style="margin-top: 8px">CSS &amp; Features</div>

  <Checkbox
    label="Container query CSS"
    bind:checked={
      () => settings.includeResizerCss ?? true,
      (v) => { settings.includeResizerCss = v; onchange(); }
    }
    disabled={isLocked("includeResizerCss")}
    locked={isLocked("includeResizerCss")}
    badge={badgeFor("includeResizerCss")}
    badgeTitle={badgeTitleFor("includeResizerCss")}
    helpId="includeResizerCss"
    help={helpFor("includeResizerCss")}
    {onchange}
  />

  <Checkbox
    label="Width data attributes"
    bind:checked={
      () => settings.includeResizerWidths ?? true,
      (v) => { settings.includeResizerWidths = v; onchange(); }
    }
    disabled={isLocked("includeResizerWidths")}
    locked={isLocked("includeResizerWidths")}
    badge={badgeFor("includeResizerWidths")}
    badgeTitle={badgeTitleFor("includeResizerWidths")}
    {onchange}
  />

  <Checkbox
    label="Inline SVG layers"
    bind:checked={
      () => settings.inlineSvg ?? false,
      (v) => { settings.inlineSvg = v; onchange(); }
    }
    disabled={isLocked("inlineSvg")}
    locked={isLocked("inlineSvg")}
    badge={badgeFor("inlineSvg")}
    badgeTitle={badgeTitleFor("inlineSvg")}
    helpId="inlineSvg"
    help={helpFor("inlineSvg")}
    {onchange}
  />

  <TextInput
    label="SVG ID prefix"
    bind:value={
      () => settings.svgIdPrefix ?? "",
      (v) => { settings.svgIdPrefix = v; onchange(); }
    }
    placeholder="(none)"
    disabled={isLocked("svgIdPrefix")}
    locked={isLocked("svgIdPrefix")}
    badge={badgeFor("svgIdPrefix")}
    badgeTitle={badgeTitleFor("svgIdPrefix")}
    {onchange}
  />

  <Checkbox
    label="Embed images in SVG"
    bind:checked={
      () => settings.svgEmbedImages ?? false,
      (v) => { settings.svgEmbedImages = v; onchange(); }
    }
    disabled={isLocked("svgEmbedImages")}
    locked={isLocked("svgEmbedImages")}
    badge={badgeFor("svgEmbedImages")}
    badgeTitle={badgeTitleFor("svgEmbedImages")}
    helpId="svgEmbedImages"
    help={helpFor("svgEmbedImages")}
    {onchange}
  />

  <Checkbox
    label="PNG transparency"
    bind:checked={
      () => settings.pngTransparent ?? false,
      (v) => { settings.pngTransparent = v; onchange(); }
    }
    disabled={isLocked("pngTransparent")}
    locked={isLocked("pngTransparent")}
    badge={badgeFor("pngTransparent")}
    badgeTitle={badgeTitleFor("pngTransparent")}
    {onchange}
  />

  <div class="section-label" style="margin-top: 8px">Accessibility</div>

  <TextInput
    label="Link URL"
    bind:value={
      () => settings.clickableLink ?? "",
      (v) => { settings.clickableLink = v; onchange(); }
    }
    placeholder="(none)"
    disabled={isLocked("clickableLink")}
    locked={isLocked("clickableLink")}
    badge={badgeFor("clickableLink")}
    badgeTitle={badgeTitleFor("clickableLink")}
    {onchange}
  />

  <TextInput
    label="Alt text"
    bind:value={
      () => settings.altText ?? "",
      (v) => { settings.altText = v; onchange(); }
    }
    placeholder="(none)"
    disabled={isLocked("altText")}
    locked={isLocked("altText")}
    badge={badgeFor("altText")}
    badgeTitle={badgeTitleFor("altText")}
    {onchange}
  />

  <TextInput
    label="ARIA role"
    bind:value={
      () => settings.ariaRole ?? "",
      (v) => { settings.ariaRole = v; onchange(); }
    }
    placeholder="(default)"
    disabled={isLocked("ariaRole")}
    locked={isLocked("ariaRole")}
    badge={badgeFor("ariaRole")}
    badgeTitle={badgeTitleFor("ariaRole")}
    {onchange}
  />
</Collapsible>
