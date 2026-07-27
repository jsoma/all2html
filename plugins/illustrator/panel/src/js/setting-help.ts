import { writable } from "svelte/store";
import { getSettingHelpDefinition } from "../../../../../src/ir/setting-help.js";
import type { PanelSettingKey } from "../shared/types.js";

export interface SettingHelpEntry {
  summary: string;
  details?: string;
  defaultNote?: string;
  optionNotes?: Record<string, string>;
  docsAnchor: string;
}

export const SETTING_HELP_DOCS_BASE_URL = "https://jsoma.github.io/all2html";

export const openSettingHelpId = writable<string | null>(null);

export function getSettingHelp(key: PanelSettingKey): SettingHelpEntry | undefined {
  const help = getSettingHelpDefinition(key);
  if (!help) return undefined;
  return {
    summary: help.summary,
    details: help.details,
    defaultNote: help.defaultNote,
    optionNotes: help.optionNotes,
    docsAnchor: help.docsAnchor,
  };
}

export function buildSettingHelpDocsUrl(anchor: string): string {
  return `${SETTING_HELP_DOCS_BASE_URL}/reference/settings/#${anchor}`;
}

export function resolveNextOpenHelpId(current: string | null, next: string): string | null {
  return current === next ? null : next;
}

export function toggleOpenSettingHelp(next: string): void {
  openSettingHelpId.update((current) => resolveNextOpenHelpId(current, next));
}

export function closeOpenSettingHelp(): void {
  openSettingHelpId.set(null);
}
