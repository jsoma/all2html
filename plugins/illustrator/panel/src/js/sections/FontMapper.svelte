<script lang="ts">
  import {
    createFontEntry,
    getFontSourceName,
    normalizeFontEntry,
    type FontEntry,
  } from "../../shared/types";
  import Collapsible from "../components/Collapsible.svelte";

  interface Props {
    fonts: FontEntry[];
    onchange: () => void;
    sourceLabel?: string;
    ondetectmissing?: (fonts: FontEntry[]) => Promise<string[]>;
  }

  let {
    fonts = $bindable(),
    onchange,
    sourceLabel = "Source Font",
    ondetectmissing,
  }: Props = $props();
  let detecting = $state(false);

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
    try {
      const missing = await ondetectmissing(fonts);
      for (const fontName of missing.filter((name) => typeof name === "string" && name.trim())) {
        if (!fonts.find((f) => getFontSourceName(f) === fontName)) {
          fonts.push(createFontEntry(fontName));
        }
      }
      fonts = fonts;
      onchange();
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
</script>

<Collapsible title="Fonts" count={countLabel} open={true}>
  <div style="margin-bottom: 6px">
    <button class="btn-secondary" onclick={detectMissing} disabled={detecting || !ondetectmissing}>
      {detecting ? "Detecting..." : "Detect missing fonts"}
    </button>
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
