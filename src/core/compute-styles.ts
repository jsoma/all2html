import type {
  BreakpointedDocument,
  CharacterRun,
  ComputedTextStyle,
  Paragraph,
  StyledArtboard,
  StyledDocument,
  StyledElement,
  StyledLayer,
  StyledTextElement,
  TextElement,
} from "../ir/types.js";
import { formatCssColorSnapNearBlack } from "./css-color.js";
import { createFontMap, type FontLookupResult } from "./font-map.js";
import {
  createWarning,
  pushUniqueStructuredWarning,
  type StructuredWarning,
  type WarningContext,
} from "./warnings.js";

const CSS_PRECISION = 4;

function round(n: number, decimals: number = CSS_PRECISION): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

// A CSS <family-name> is either a quoted string or a whitespace-separated run of
// identifiers. Font mappings arrive from `all2html.config.json`, document XMP and
// the panel font editor, so a value that is not a legal family name must never be
// concatenated into the stylesheet — `X}</style><svg onload=alert(1)>{a` would
// otherwise close the <style> element and become live markup.
// Validated by a hand-written scan, not a regex. Any pattern that nests
// quantifiers backtracks exponentially in ExtendScript's engine where V8 does
// not — an equivalent regex here hung Illustrator for minutes per call.
// Enforced by test/integration/extendscript-regex-safety.test.ts.
const FALLBACK_FONT_FAMILY = "sans-serif";

// font-weight / font-style are keyword-or-number values from the same sources.
// This one has no nested quantifier — a single character class over the whole
// string is linear in every engine.
const CSS_KEYWORD_VALUE = /^[a-zA-Z0-9%. -]*$/;

// `[_a-zA-Z\u00A0-\uFFFF]` from the original grammar. The upper range admits
// non-ASCII family names and deliberately starts at U+00A0 — above every
// character that could break out of a declaration or the <style> element.
function isFamilyIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch >= "\u00A0";
}

function isFamilyIdentChar(ch: string): boolean {
  return isFamilyIdentStart(ch) || (ch >= "0" && ch <= "9") || ch === "-";
}

/**
 * Characters that may not appear inside a *quoted* family name.
 *
 * The explicit five (`"`, `'`, `<`, `>`, `\`) are the ones that end the string,
 * the declaration or the `<style>` element directly. The control range is the
 * part that was wrong: CSS preprocessing (css-syntax-3 §3.3) rewrites CR, FF and
 * CRLF to LF *before* tokenizing, and a newline inside a string token is a parse
 * error that terminates the string. A check that named only CR and LF therefore
 * let U+000C through, and `"Safe\f;}body{display:none}/*"` validated while the
 * browser saw the string end at the form feed.
 *
 * So this rejects the whole class rather than the one character that was found:
 * every C0 control (U+0000-U+001F, which covers CR, LF, FF and both halves of a
 * CRLF pair) plus DEL (U+007F). U+0000 matters separately — preprocessing
 * rewrites it to U+FFFD, so it can never be part of a family name that resolves.
 * No real family name contains any of them, so nothing legitimate is lost.
 *
 * Written as a scan rather than a regex on purpose; see the note above on
 * ExtendScript's backtracking.
 */
function isDisallowedInQuotedFamily(ch: string): boolean {
  if (ch <= "\u001F" || ch === "\u007F") return true;
  return ch === '"' || ch === "'" || ch === "<" || ch === ">" || ch === "\\";
}

/** One comma-separated component: either a quoted string or space-separated idents. */
function isValidFamilyName(raw: string): boolean {
  const name = raw.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
  if (name.length === 0) return false;

  const quote = name.charAt(0);
  if (quote === '"' || quote === "'") {
    if (name.length < 2 || name.charAt(name.length - 1) !== quote) return false;
    const inner = name.slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      // The characters that could end the attribute, the <style> element, or the
      // declaration if they reached the stylesheet.
      if (isDisallowedInQuotedFamily(inner.charAt(i))) return false;
    }
    return true;
  }

  // Unquoted: `-?ident( ident)*`, where each ident starts with a letter.
  let i = 0;
  if (name.charAt(0) === "-") i = 1;
  let atWordStart = true;
  let sawWord = false;
  for (; i < name.length; i++) {
    const ch = name.charAt(i);
    if (ch === " " || ch === "\t") {
      // The separator was `[ \t]+`, so a run of them is one separator. An
      // earlier draft rejected the second space and diverged on "Helvetica  Neue".
      if (!sawWord) return false; // separator before any word
      atWordStart = true;
      continue;
    }
    if (atWordStart) {
      if (!isFamilyIdentStart(ch)) return false;
      atWordStart = false;
      sawWord = true;
      continue;
    }
    if (!isFamilyIdentChar(ch)) return false;
  }
  return sawWord;
}

export function isValidCssFontFamily(value: string): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split(",");
  for (let i = 0; i < parts.length; i++) {
    if (!isValidFamilyName(parts[i])) return false;
  }
  return true;
}

/** Keep `value` if it is a legal CSS value, otherwise warn (naming the font) and
 *  substitute `fallback`, so no source-controlled garbage reaches the stylesheet. */
function guardCssValue(
  property: string,
  value: string,
  valid: boolean,
  fallback: string,
  fontName: string,
  warnings: StructuredWarning[],
  context: WarningContext,
): string {
  if (valid) return value;
  warnings.push(
    createWarning(
      "font:invalid-css-value",
      "font",
      `Invalid CSS ${property} for font "${fontName}": ${JSON.stringify(value)}. Using ${fallback} instead.`,
      context,
    ),
  );
  return fallback;
}

function computeRunStyle(
  run: CharacterRun,
  paragraph: Paragraph,
  element: TextElement,
  fontLookup: (name: string) => FontLookupResult,
  context: WarningContext,
): { style: ComputedTextStyle; warnings: StructuredWarning[] } {
  const { info, matched } = fontLookup(run.fontName);
  const warnings: StructuredWarning[] = [];
  if (!matched) {
    warnings.push(
      createWarning(
        "font:unmapped",
        "font",
        `Missing a rule for converting font: ${run.fontName}. Sample text: "${run.text.slice(0, 30)}"`,
        context,
      ),
    );
  }

  const weight = info.weight || "normal";
  const styleName = info.style || "normal";
  const fontFamily = guardCssValue(
    "font-family",
    info.family,
    isValidCssFontFamily(info.family),
    FALLBACK_FONT_FAMILY,
    run.fontName,
    warnings,
    context,
  );
  const fontWeight = guardCssValue(
    "font-weight",
    weight,
    CSS_KEYWORD_VALUE.test(weight),
    "normal",
    run.fontName,
    warnings,
    context,
  );
  const fontStyle = guardCssValue(
    "font-style",
    styleName,
    CSS_KEYWORD_VALUE.test(styleName),
    "normal",
    run.fontName,
    warnings,
    context,
  );

  let fontSize = run.fontSize;
  const isSuperSub = run.baselineShift !== "normal";
  if (isSuperSub) {
    fontSize = round(fontSize * 0.7);
  }

  const style: ComputedTextStyle = {
    fontFamily,
    fontSize: `${fontSize}px`,
    fontWeight,
    fontStyle,
    // The near-black snap is text-run parity behavior only — fills, strokes and
    // area styling use the plain formatter (`src/core/css-color.ts`).
    color: formatCssColorSnapNearBlack(run.color),
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

  return { style, warnings };
}

export function computeStyles(doc: BreakpointedDocument): {
  document: StyledDocument;
  warnings: StructuredWarning[];
} {
  const warnings: StructuredWarning[] = [];
  const fontLookup = createFontMap(doc.fonts);

  const artboards: StyledArtboard[] = doc.artboards.map((ab) => {
    const layers: StyledLayer[] = ab.layers.map((layer) => {
      const elements: StyledElement[] = layer.elements.map((el) => {
        if (el.type !== "text") return el;
        // Image-rendered text is its own variant, so the "not styled" branch returns a
        // named type instead of asserting one (SPEC §12.1).
        if (el.renderAs === "image") return el;

        // A font problem is a document-level problem, so identical messages are
        // collapsed; the context recorded is where it was first seen.
        const context: WarningContext = {
          artboardId: ab.id,
          layerId: layer.id,
          elementId: el.id,
        };
        const computedParagraphStyles: ComputedTextStyle[] = [];
        const computedRunStyles: ComputedTextStyle[][] = [];

        for (const para of el.paragraphs) {
          const firstRun = para.runs[0];
          const { style: paraStyle, warnings: paraWarnings } = computeRunStyle(
            firstRun,
            para,
            el,
            fontLookup,
            context,
          );
          for (const warning of paraWarnings) {
            pushUniqueStructuredWarning(warnings, warning);
          }
          computedParagraphStyles.push(paraStyle);

          const runStyles: ComputedTextStyle[] = [];
          for (const run of para.runs) {
            const { style: runStyle, warnings: runWarnings } = computeRunStyle(
              run,
              para,
              el,
              fontLookup,
              context,
            );
            for (const warning of runWarnings) {
              pushUniqueStructuredWarning(warnings, warning);
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

  return { document: { ...doc, pipelinePhase: "styled", artboards }, warnings };
}
