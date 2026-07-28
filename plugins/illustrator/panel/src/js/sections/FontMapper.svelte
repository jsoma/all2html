<script lang="ts">
  import {
    createFontEntry,
    getFontSourceName,
    normalizeFontEntry,
    type FontEntry,
  } from "../../shared/types";
  import Collapsible from "../components/Collapsible.svelte";
  import FieldHelp from "../components/FieldHelp.svelte";
  import { getSettingHelp } from "../setting-help.js";

  type GoogleFontsMode = "none" | "import" | "link";

  interface Props {
    fonts: FontEntry[];
    onchange: () => void;
    googleFonts?: GoogleFontsMode;
    googleFontsDisabled?: boolean;
    googleFontsLocked?: boolean;
    googleFontsBadge?: string;
    googleFontsBadgeTitle?: string;
    ongooglefontschange?: (value: GoogleFontsMode) => void;
    sourceLabel?: string;
    ondetectmissing?: (fonts: FontEntry[]) => Promise<string[]>;
  }

  let {
    fonts = $bindable(),
    onchange,
    googleFonts = "none",
    googleFontsDisabled = false,
    googleFontsLocked = false,
    googleFontsBadge = "",
    googleFontsBadgeTitle,
    ongooglefontschange,
    sourceLabel = "Source Font",
    ondetectmissing,
  }: Props = $props();
  let detecting = $state(false);
  let detectError = $state("");

  const mappedCount = $derived(fonts.filter((f) => f.family).length);
  const missingCount = $derived(fonts.filter((f) => !f.family).length);
  const countLabel = $derived.by(() => {
    const parts: string[] = [];
    if (mappedCount > 0) parts.push(`${mappedCount} mapped`);
    if (missingCount > 0) parts.push(`${missingCount} missing`);
    return parts.join(", ") || "none";
  });

  async function detectMissing(): Promise<void> {
    if (!ondetectmissing) return;
    detecting = true;
    detectError = "";
    try {
      const missing = await ondetectmissing(fonts);
      for (const fontName of missing.filter((name) => typeof name === "string" && name.trim())) {
        if (!fonts.find((f) => getFontSourceName(f) === fontName)) {
          fonts.push(createFontEntry(fontName));
        }
      }
      fonts = fonts;
      onchange();
    } catch (e) {
      // The AE bridge now throws on a stale/absent target comp instead of
      // returning an empty list; a swallowed rejection here looked like
      // "no missing fonts", which is the failure mode it replaced.
      detectError = String(e instanceof Error ? e.message : e);
    } finally {
      detecting = false;
    }
  }

  function removeFont(index: number): void {
    fonts.splice(index, 1);
    fonts = fonts;
    onchange();
  }

  function updateFont(index: number, field: keyof FontEntry, value: string): void {
    fonts[index] = normalizeFontEntry({
      ...fonts[index],
      [field]: value,
    });
    fonts = fonts;
    onchange();
  }

  function changeGoogleFonts(value: string): void {
    if (googleFontsDisabled) return;
    const mode: GoogleFontsMode = value === "import" || value === "link" ? value : "none";
    googleFonts = mode;
    ongooglefontschange?.(mode);
  }
</script>

<Collapsible title="Fonts" count={countLabel} open={true}>
  <div style="margin-bottom: 8px">
    <FieldHelp
      label="Google Fonts"
      helpId="googleFonts"
      help={getSettingHelp("googleFonts")}
      locked={googleFontsLocked}
      badge={googleFontsBadge}
      badgeTitle={googleFontsBadgeTitle}
    >
      {#snippet children()}
      <select
        id="google-fonts-select"
        value={googleFonts}
        disabled={googleFontsDisabled}
        title={googleFontsLocked ? "Controlled by ai2html-settings in the document" : undefined}
        onchange={(e) => changeGoogleFonts((e.target as HTMLSelectElement).value)}
      >
        <option value="none">Off</option>
        <option value="import">CSS @import</option>
        <option value="link">Link tag</option>
      </select>
      {/snippet}
    </FieldHelp>
  </div>

  <div style="margin-bottom: 6px">
    <button class="btn-secondary" onclick={detectMissing} disabled={detecting || !ondetectmissing}>
      {detecting ? "Detecting..." : "Detect missing fonts"}
    </button>
    {#if detectError}
      <div class="panel-note panel-note-warning">{detectError}</div>
    {/if}
  </div>

  {#if fonts.length > 0}
    <table class="font-table">
      <thead>
        <tr>
          <th>{sourceLabel}</th>
          <th>CSS Family</th>
          <th>Wt</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each fonts as font, i}
          <tr class:font-missing={!font.family}>
            <td title={getFontSourceName(font)}>
              <span style="max-width: 80px; display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                {getFontSourceName(font)}
              </span>
            </td>
            <td>
              <input
                type="text"
                value={font.family}
                placeholder="Arial, sans-serif"
                onchange={(e) => updateFont(i, "family", (e.target as HTMLInputElement).value)}
              />
            </td>
            <td>
              <input
                type="text"
                value={font.weight ?? ""}
                placeholder="400"
                style="width: 36px"
                onchange={(e) => updateFont(i, "weight", (e.target as HTMLInputElement).value)}
              />
            </td>
            <td>
              <button
                class="btn-secondary"
                style="padding: 1px 4px; font-size: 9px"
                onclick={() => removeFont(i)}
              >&#10005;</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <div style="color: var(--text-secondary); font-size: 10px; padding: 4px 0">
      No font mappings. Click "Detect missing fonts" to scan the document.
    </div>
  {/if}
</Collapsible>
