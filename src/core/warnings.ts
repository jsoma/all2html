/**
 * Warning consolidation — groups warnings by type for clearer output.
 */

export interface GroupedWarnings {
  fonts: string[];
  masks: string[];
  rotation: string[];
  overset: string[];
  settings: string[];
  other: string[];
}

export function groupWarnings(warnings: string[]): GroupedWarnings {
  const grouped: GroupedWarnings = {
    fonts: [],
    masks: [],
    rotation: [],
    overset: [],
    settings: [],
    other: [],
  };

  for (const w of warnings) {
    if (w.includes("font") || w.includes("Font")) {
      grouped.fonts.push(w);
    } else if (w.includes("mask") || w.includes("Mask") || w.includes("clip")) {
      grouped.masks.push(w);
    } else if (w.includes("rotat") || w.includes("skew")) {
      grouped.rotation.push(w);
    } else if (w.includes("overset") || w.includes("overflow")) {
      grouped.overset.push(w);
    } else if (w.includes("setting") || w.includes("parameter")) {
      grouped.settings.push(w);
    } else {
      grouped.other.push(w);
    }
  }

  return grouped;
}

export function formatGroupedWarnings(grouped: GroupedWarnings): string {
  const sections: string[] = [];

  if (grouped.fonts.length > 0) {
    sections.push(`Missing font mappings (${grouped.fonts.length}):`);
    for (const w of grouped.fonts) sections.push(`  ${w}`);
  }
  if (grouped.masks.length > 0) {
    sections.push(`Clipping mask issues (${grouped.masks.length}):`);
    for (const w of grouped.masks) sections.push(`  ${w}`);
  }
  if (grouped.rotation.length > 0) {
    sections.push(`Rotation/skew (${grouped.rotation.length}):`);
    for (const w of grouped.rotation) sections.push(`  ${w}`);
  }
  if (grouped.overset.length > 0) {
    sections.push(`Overset text (${grouped.overset.length}):`);
    for (const w of grouped.overset) sections.push(`  ${w}`);
  }
  if (grouped.settings.length > 0) {
    sections.push(`Settings (${grouped.settings.length}):`);
    for (const w of grouped.settings) sections.push(`  ${w}`);
  }
  if (grouped.other.length > 0) {
    sections.push(`Other (${grouped.other.length}):`);
    for (const w of grouped.other) sections.push(`  ${w}`);
  }

  return sections.join("\n");
}
