import {
  type PanelSettingKey,
  type PanelSettings,
  panelDefaults,
  type SettingSource,
} from "../shared/types.js";

export type FieldSources = Partial<Record<PanelSettingKey, SettingSource>>;
export type EditedKeys = PanelSettingKey[];

const panelValueDefaults: Partial<Record<PanelSettingKey, unknown>> = {
  ...panelDefaults,
  maxWidth: null,
  cacheBustToken: null,
  clickableLink: "",
  altText: "",
  ariaRole: "",
};

function getComparableValue(settings: PanelSettings, key: PanelSettingKey): unknown {
  const value = settings[key];
  if (value !== undefined) return value;
  return panelValueDefaults[key];
}

export function getEditedKeys(
  current: PanelSettings,
  inherited: PanelSettings,
  documentControlledKeys: PanelSettingKey[],
): EditedKeys {
  const locked = new Set(documentControlledKeys);
  const allKeys = new Set<PanelSettingKey>([
    ...(Object.keys(panelValueDefaults) as PanelSettingKey[]),
    ...(Object.keys(current) as PanelSettingKey[]),
    ...(Object.keys(inherited) as PanelSettingKey[]),
  ]);

  const edited: PanelSettingKey[] = [];
  for (const key of allKeys) {
    if (locked.has(key)) continue;
    if (
      JSON.stringify(getComparableValue(current, key)) !==
      JSON.stringify(getComparableValue(inherited, key))
    ) {
      edited.push(key);
    }
  }
  return edited;
}

export function getFieldBadge(
  fieldSources: FieldSources,
  key: PanelSettingKey,
  locked: boolean,
  edited: boolean,
): string {
  if (locked) return "doc";
  if (edited) return "edit";

  const source = fieldSources[key];
  switch (source) {
    case "document-xmp":
      return "xmp";
    case "config-file":
      return "cfg";
    case "app-defaults":
      return "def";
    default:
      return "";
  }
}

export function getFieldBadgeTitle(
  fieldSources: FieldSources,
  key: PanelSettingKey,
  locked: boolean,
  edited: boolean,
): string | undefined {
  if (locked) return "Controlled by ai2html-settings in the document";
  if (edited) return "Edited in the panel for this document";

  const source = fieldSources[key];
  switch (source) {
    case "document-xmp":
      return "Loaded from document XMP";
    case "config-file":
      return "Loaded from all2html.config.json";
    case "app-defaults":
      return "Loaded from saved panel defaults";
    default:
      return undefined;
  }
}
