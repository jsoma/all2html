import type {
  CharacterRun,
  Color,
  ComputedTextStyle,
  Paragraph,
  ResolvedDocument,
  StyledArtboard,
  StyledDocument,
  StyledLayer,
  StyledTextElement,
  TextElement,
} from "../ir/types.js";
import { createFontMap, type FontLookupResult } from "./font-map.js";

const RGB_BLACK_THRESHOLD = 36;
const CSS_PRECISION = 4;

function round(n: number, decimals: number = CSS_PRECISION): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function formatColor(color: Color): string {
  let { r, g, b } = color;
  if (r < RGB_BLACK_THRESHOLD && g < RGB_BLACK_THRESHOLD && b < RGB_BLACK_THRESHOLD) {
    r = g = b = 0;
  }
  if (color.opacity !== undefined && color.opacity < 100) {
    return `rgba(${r},${g},${b},${round(color.opacity / 100, 2)})`;
  }
  return `rgb(${r},${g},${b})`;
}

function computeRunStyle(
  run: CharacterRun,
  paragraph: Paragraph,
  element: TextElement,
  fontLookup: (name: string) => FontLookupResult,
): { style: ComputedTextStyle; warning?: string } {
  const { info, matched } = fontLookup(run.fontName);
  let warning: string | undefined;
  if (!matched) {
    warning = `Missing a rule for converting font: ${run.fontName}. Sample text: "${run.text.slice(0, 30)}"`;
  }

  let fontSize = run.fontSize;
  const isSuperSub = run.baselineShift !== "normal";
  if (isSuperSub) {
    fontSize = round(fontSize * 0.7);
  }

  const style: ComputedTextStyle = {
    fontFamily: info.family,
    fontSize: `${fontSize}px`,
    fontWeight: info.weight || "normal",
    fontStyle: info.style || "normal",
    color: formatColor(run.color),
    lineHeight: `${paragraph.leading}px`,
  };

  // Explicit margin:0 prevents CMS stylesheets from adding paragraph margins
  style.margin = "0";

  // Always include textAlign so style dedup can diff correctly
  // (omitting "left" causes bugs when base style is right/center-aligned)
  style.textAlign = paragraph.alignment;

  // Point text: set height = lineHeight (Chrome zoom fix)
  if (element.kind === "point") {
    style.height = style.lineHeight;
  }

  if (run.letterSpacing !== 0) {
    style.letterSpacing = `${round(run.letterSpacing)}em`;
  }

  if (run.capitalization === "allcaps" || run.capitalization === "smallcaps") {
    style.textTransform = "uppercase";
  }

  if (run.baselineShift === "superscript") {
    style.verticalAlign = "super";
  } else if (run.baselineShift === "subscript") {
    style.verticalAlign = "sub";
  }

  if (element.opacity < 100) {
    style.opacity = String(round(element.opacity / 100, 2));
  }

  if (element.blendMode === "multiply") {
    style.mixBlendMode = "multiply";
  }

  if (paragraph.spaceBefore > 0) {
    style.paddingTop = `${paragraph.spaceBefore}px`;
  }
  if (paragraph.spaceAfter > 0) {
    style.paddingBottom = `${paragraph.spaceAfter}px`;
  }

  // vshift for point text
  if (element.kind === "point" && info.vshift) {
    const pct = parseFloat(info.vshift);
    if (!Number.isNaN(pct) && pct !== 0) {
      const px = round((run.fontSize * pct) / 100);
      style.top = `${px}px`;
      style.position = "relative";
    }
  }

  return { style, warning };
}

export function computeStyles(doc: ResolvedDocument): {
  document: StyledDocument;
  warnings: string[];
} {
  const warnings: string[] = [];
  const fontLookup = createFontMap(doc.fonts);

  const artboards: StyledArtboard[] = doc.artboards.map((ab) => {
    const layers: StyledLayer[] = ab.layers.map((layer) => {
      const elements: StyledLayer["elements"] = layer.elements.map((el) => {
        if (el.type !== "text" || el.renderAs === "image")
          return el as StyledLayer["elements"][number];

        const computedParagraphStyles: ComputedTextStyle[] = [];
        const computedRunStyles: ComputedTextStyle[][] = [];

        for (const para of el.paragraphs) {
          const firstRun = para.runs[0];
          const { style: paraStyle, warning: paraWarning } = computeRunStyle(
            firstRun,
            para,
            el,
            fontLookup,
          );
          if (paraWarning && !warnings.includes(paraWarning)) {
            warnings.push(paraWarning);
          }
          computedParagraphStyles.push(paraStyle);

          const runStyles: ComputedTextStyle[] = [];
          for (const run of para.runs) {
            const { style: runStyle, warning: runWarning } = computeRunStyle(
              run,
              para,
              el,
              fontLookup,
            );
            if (runWarning && !warnings.includes(runWarning)) {
              warnings.push(runWarning);
            }
            runStyles.push(runStyle);
          }
          computedRunStyles.push(runStyles);
        }

        const styled: StyledTextElement = {
          ...el,
          computedParagraphStyles,
          computedRunStyles,
        };
        return styled;
      });
      return { ...layer, elements };
    });
    return { ...ab, layers };
  });

  return { document: { ...doc, artboards }, warnings };
}
