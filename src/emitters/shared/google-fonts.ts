import type { FontMapping } from "../../ir/types.js";
import { escapeAttr } from "./escape.js";

export interface GoogleFontLinkTag {
  href: string;
  rel: "preconnect" | "stylesheet";
  crossorigin?: boolean;
}

interface FamilyRequest {
  family: string;
  normalWeights: string[];
  italicWeights: string[];
}

const GOOGLE_FONTS_BASE_URL = "https://fonts.googleapis.com/css2";

const SKIPPED_FAMILIES = [
  "arial",
  "arial black",
  "avenir",
  "avenir next",
  "blinkmacsystemfont",
  "calibri",
  "cambria",
  "candara",
  "comic sans ms",
  "consolas",
  "courier",
  "courier new",
  "didot",
  "fantasy",
  "futura",
  "garamond",
  "geneva",
  "georgia",
  "gill sans",
  "helvetica",
  "helvetica neue",
  "impact",
  "menlo",
  "monaco",
  "monospace",
  "optima",
  "palatino",
  "sans",
  "sans-serif",
  "serif",
  "system-ui",
  "tahoma",
  "times",
  "times new roman",
  "trebuchet ms",
  "ui-monospace",
  "ui-rounded",
  "ui-sans-serif",
  "ui-serif",
  "verdana",
  "-apple-system",
];

function isSkippedFamily(family: string): boolean {
  const normalized = family.trim().toLowerCase();
  if (!normalized || normalized.indexOf("var(") === 0) return true;
  for (let i = 0; i < SKIPPED_FAMILIES.length; i += 1) {
    if (normalized === SKIPPED_FAMILIES[i]) return true;
  }
  return false;
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed.charAt(0);
  const last = trimmed.charAt(trimmed.length - 1);
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
    return trimmed.slice(1, -1).replace(/\\(["'])/g, "$1");
  }
  return trimmed;
}

export function getPrimaryCssFamily(cssFamily: string): string | null {
  let quote = "";
  let start = 0;
  for (let i = 0; i < cssFamily.length; i += 1) {
    const chr = cssFamily.charAt(i);
    if (quote) {
      if (chr === "\\" && i + 1 < cssFamily.length) {
        i += 1;
        continue;
      }
      if (chr === quote) quote = "";
      continue;
    }
    if (chr === "'" || chr === '"') {
      quote = chr;
      continue;
    }
    if (chr === ",") {
      const family = stripWrappingQuotes(cssFamily.slice(start, i));
      if (family && !isSkippedFamily(family)) return family;
      start = i + 1;
    }
  }

  const family = stripWrappingQuotes(cssFamily.slice(start));
  return family && !isSkippedFamily(family) ? family : null;
}

function normalizeWeight(weight: string | undefined): string {
  const normalized = String(weight || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "normal" || normalized === "regular") return "400";
  if (normalized === "bold") return "700";

  const parsed = parseInt(normalized, 10);
  if (Number.isNaN(parsed)) return "400";
  const rounded = Math.round(parsed / 100) * 100;
  return String(Math.max(100, Math.min(900, rounded)));
}

function isItalicStyle(style: string | undefined): boolean {
  return /italic|oblique/i.test(String(style || ""));
}

function addUnique(values: string[], value: string): void {
  if (values.indexOf(value) === -1) values.push(value);
}

function compareWeights(a: string, b: string): number {
  return parseInt(a, 10) - parseInt(b, 10);
}

function collectFamilyRequests(fonts: readonly FontMapping[]): FamilyRequest[] {
  const requests: FamilyRequest[] = [];

  for (const font of fonts) {
    // The type is a claim, not a guarantee: Illustrator and After Effects reach
    // this with no Zod between them and the file on disk. `compute-styles.ts`
    // already checks a non-string family and falls back; this consumer did not,
    // so the same malformed mapping that merely warned in the CSS path turned an
    // optional Google Fonts feature into `cssFamily.charAt is not a function`
    // and failed the whole export.
    if (!font || typeof font.family !== "string") continue;
    const family = getPrimaryCssFamily(font.family);
    if (!family) continue;

    let request: FamilyRequest | null = null;
    for (let i = 0; i < requests.length; i += 1) {
      if (requests[i].family === family) {
        request = requests[i];
        break;
      }
    }
    if (!request) {
      request = { family, normalWeights: [], italicWeights: [] };
      requests.push(request);
    }

    const weight = normalizeWeight(font.weight);
    if (isItalicStyle(font.style)) {
      addUnique(request.italicWeights, weight);
    } else {
      addUnique(request.normalWeights, weight);
    }
  }

  for (const request of requests) {
    request.normalWeights.sort(compareWeights);
    request.italicWeights.sort(compareWeights);
  }

  return requests;
}

function encodeFamilyName(family: string): string {
  return encodeURIComponent(family).replace(/%20/g, "+");
}

function buildFamilyParam(request: FamilyRequest): string {
  const family = encodeFamilyName(request.family);
  if (request.italicWeights.length === 0) {
    const weights = request.normalWeights.length > 0 ? request.normalWeights : ["400"];
    return `family=${family}:wght@${weights.join(";")}`;
  }

  const pairs: string[] = [];
  for (const weight of request.normalWeights) pairs.push(`0,${weight}`);
  for (const weight of request.italicWeights) pairs.push(`1,${weight}`);
  return `family=${family}:ital,wght@${pairs.join(";")}`;
}

export function buildGoogleFontsUrl(fonts: readonly FontMapping[]): string | null {
  const requests = collectFamilyRequests(fonts);
  if (requests.length === 0) return null;

  const params = requests.map(buildFamilyParam);
  params.push("display=swap");
  return `${GOOGLE_FONTS_BASE_URL}?${params.join("&")}`;
}

export function renderGoogleFontsImport(fonts: readonly FontMapping[]): string {
  const url = buildGoogleFontsUrl(fonts);
  return url ? `@import url("${url}");` : "";
}

export function getGoogleFontsLinkTags(fonts: readonly FontMapping[]): GoogleFontLinkTag[] {
  const url = buildGoogleFontsUrl(fonts);
  if (!url) return [];
  return [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: true },
    { rel: "stylesheet", href: url },
  ];
}

/**
 * Renders the `<link>` tags for `googleFonts: "link"`.
 *
 * The tags used to carry a `data-all2html-google-fonts="true"` marker so that the
 * Svelte and React emitters could regex them back out of serialized HTML. Since
 * SPEC §12.6 / D23 those emitters consume the node tree and simply never build
 * the links (`shared/component-tree.ts` carries the href out separately), so the
 * stripper and its marker were removed: nothing read the attribute, and it
 * shipped into every exported page.
 */
export function renderGoogleFontsLinkTags(fonts: readonly FontMapping[]): string {
  const links = getGoogleFontsLinkTags(fonts);
  return links
    .map((link) => {
      const crossorigin = link.crossorigin ? " crossorigin" : "";
      return (
        '<link rel="' + link.rel + '" href="' + escapeAttr(link.href) + '"' + crossorigin + ">"
      );
    })
    .join("");
}
