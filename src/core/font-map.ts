import type { FontMapping } from "../ir/types.js";

const builtinFonts: FontMapping[] = [
  { sourceFont: "ArialMT", family: "arial,helvetica,sans-serif", weight: "", style: "" },
  { sourceFont: "Arial-BoldMT", family: "arial,helvetica,sans-serif", weight: "700", style: "" },
  {
    sourceFont: "Arial-ItalicMT",
    family: "arial,helvetica,sans-serif",
    weight: "",
    style: "italic",
  },
  {
    sourceFont: "Arial-BoldItalicMT",
    family: "arial,helvetica,sans-serif",
    weight: "700",
    style: "italic",
  },
  { sourceFont: "Georgia", family: "georgia,'times new roman',times,serif", weight: "", style: "" },
  {
    sourceFont: "Georgia-Bold",
    family: "georgia,'times new roman',times,serif",
    weight: "700",
    style: "",
  },
  {
    sourceFont: "Georgia-Italic",
    family: "georgia,'times new roman',times,serif",
    weight: "",
    style: "italic",
  },
  {
    sourceFont: "Georgia-BoldItalic",
    family: "georgia,'times new roman',times,serif",
    weight: "700",
    style: "italic",
  },
  { sourceFont: "Inter-Regular", family: "Inter,system-ui,sans-serif", weight: "400", style: "" },
  { sourceFont: "Inter-Medium", family: "Inter,system-ui,sans-serif", weight: "500", style: "" },
  { sourceFont: "Inter-SemiBold", family: "Inter,system-ui,sans-serif", weight: "600", style: "" },
  { sourceFont: "Inter-Bold", family: "Inter,system-ui,sans-serif", weight: "700", style: "" },
  {
    sourceFont: "Inter-Italic",
    family: "Inter,system-ui,sans-serif",
    weight: "400",
    style: "italic",
  },
  {
    sourceFont: "Inter-MediumItalic",
    family: "Inter,system-ui,sans-serif",
    weight: "500",
    style: "italic",
  },
  {
    sourceFont: "Inter-SemiBoldItalic",
    family: "Inter,system-ui,sans-serif",
    weight: "600",
    style: "italic",
  },
  {
    sourceFont: "Inter-BoldItalic",
    family: "Inter,system-ui,sans-serif",
    weight: "700",
    style: "italic",
  },
];

export interface FontInfo {
  family: string;
  weight: string;
  style: string;
  vshift?: string;
}

export interface FontLookupResult {
  info: FontInfo;
  matched: boolean;
}

export function createFontMap(
  customFonts: FontMapping[],
): (sourceFont: string) => FontLookupResult {
  // Merge builtin + custom (custom overrides builtin)
  const table: FontMapping[] = [...builtinFonts];
  for (const font of customFonts) {
    const idx = table.findIndex((f) => f.sourceFont === font.sourceFont);
    if (idx >= 0) {
      table[idx] = font;
    } else {
      table.push(font);
    }
  }

  return function lookupFont(sourceFont: string): FontLookupResult {
    const entry = table.find((f) => f.sourceFont === sourceFont);
    if (entry) {
      return {
        info: {
          family: entry.family,
          weight: entry.weight ?? "",
          style: entry.style ?? "",
          vshift: entry.vshift,
        },
        matched: true,
      };
    }

    // Heuristic fallback
    const lower = sourceFont.toLowerCase();
    const isItalic = lower.includes("italic") || lower.includes("oblique");
    const isBold = lower.includes("bold");
    return {
      info: {
        family: sourceFont.replace(/-/g, " "),
        weight: isBold ? "700" : "500",
        style: isItalic ? "italic" : "",
      },
      matched: false,
    };
  };
}
