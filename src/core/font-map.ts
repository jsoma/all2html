import type { FontMapping } from "../ir/types.js";

const builtinFonts: FontMapping[] = [
  { aifont: "ArialMT", family: "arial,helvetica,sans-serif", weight: "", style: "" },
  { aifont: "Arial-BoldMT", family: "arial,helvetica,sans-serif", weight: "700", style: "" },
  { aifont: "Arial-ItalicMT", family: "arial,helvetica,sans-serif", weight: "", style: "italic" },
  {
    aifont: "Arial-BoldItalicMT",
    family: "arial,helvetica,sans-serif",
    weight: "700",
    style: "italic",
  },
  { aifont: "Georgia", family: "georgia,'times new roman',times,serif", weight: "", style: "" },
  {
    aifont: "Georgia-Bold",
    family: "georgia,'times new roman',times,serif",
    weight: "700",
    style: "",
  },
  {
    aifont: "Georgia-Italic",
    family: "georgia,'times new roman',times,serif",
    weight: "",
    style: "italic",
  },
  {
    aifont: "Georgia-BoldItalic",
    family: "georgia,'times new roman',times,serif",
    weight: "700",
    style: "italic",
  },
  { aifont: "Inter-Regular", family: "Inter,system-ui,sans-serif", weight: "400", style: "" },
  { aifont: "Inter-Medium", family: "Inter,system-ui,sans-serif", weight: "500", style: "" },
  { aifont: "Inter-SemiBold", family: "Inter,system-ui,sans-serif", weight: "600", style: "" },
  { aifont: "Inter-Bold", family: "Inter,system-ui,sans-serif", weight: "700", style: "" },
  {
    aifont: "Inter-Italic",
    family: "Inter,system-ui,sans-serif",
    weight: "400",
    style: "italic",
  },
  {
    aifont: "Inter-MediumItalic",
    family: "Inter,system-ui,sans-serif",
    weight: "500",
    style: "italic",
  },
  {
    aifont: "Inter-SemiBoldItalic",
    family: "Inter,system-ui,sans-serif",
    weight: "600",
    style: "italic",
  },
  {
    aifont: "Inter-BoldItalic",
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

export function createFontMap(customFonts: FontMapping[]): (aifont: string) => FontLookupResult {
  // Merge builtin + custom (custom overrides builtin)
  const table: FontMapping[] = [...builtinFonts];
  for (const font of customFonts) {
    const idx = table.findIndex((f) => f.aifont === font.aifont);
    if (idx >= 0) {
      table[idx] = font;
    } else {
      table.push(font);
    }
  }

  return function lookupFont(aifont: string): FontLookupResult {
    const entry = table.find((f) => f.aifont === aifont);
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
    const lower = aifont.toLowerCase();
    const isItalic = lower.includes("italic") || lower.includes("oblique");
    const isBold = lower.includes("bold");
    return {
      info: {
        family: aifont.replace(/-/g, " "),
        weight: isBold ? "700" : "500",
        style: isItalic ? "italic" : "",
      },
      matched: false,
    };
  };
}
