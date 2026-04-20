/**
 * Text extraction utilities for the Figma input plugin.
 * Figma-specific extraction stays here; the output is canonical IR data.
 */

import type { CharacterRun, Paragraph } from "../../../../src/ir/types.js";
import type { ExtractedTextRun } from "../types.js";

export interface FigmaTextSegment {
  characters: string;
  start: number;
  end: number;
  fontName: { family: string; style: string };
  fontSize: number;
  letterSpacing: { value: number; unit: "PIXELS" | "PERCENT" };
  lineHeight: { value: number; unit: "PIXELS" | "PERCENT" | "AUTO" };
  fills: Array<{ type: string; color?: { r: number; g: number; b: number }; opacity?: number }>;
  textCase: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
  textDecoration: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  hyperlink?: { type: "URL" | "NODE"; value: string };
}

function toChannel(value: number): number {
  return Math.round(value * 255);
}

export function segmentToRun(segment: FigmaTextSegment): ExtractedTextRun {
  const solidFill = segment.fills.find((fill) => fill.type === "SOLID" && fill.color);
  const color: CharacterRun["color"] = solidFill?.color
    ? {
        r: toChannel(solidFill.color.r),
        g: toChannel(solidFill.color.g),
        b: toChannel(solidFill.color.b),
        ...(solidFill.opacity != null && solidFill.opacity < 1
          ? { opacity: Math.round(solidFill.opacity * 100) }
          : {}),
      }
    : { r: 0, g: 0, b: 0 };

  let letterSpacing = 0;
  if (segment.letterSpacing.unit === "PIXELS") {
    letterSpacing = segment.fontSize === 0 ? 0 : segment.letterSpacing.value / segment.fontSize;
  } else if (segment.letterSpacing.unit === "PERCENT") {
    letterSpacing = segment.letterSpacing.value / 100;
  }

  let capitalization: CharacterRun["capitalization"] = "normal";
  if (segment.textCase === "UPPER") {
    capitalization = "allcaps";
  }

  let hyperlink: CharacterRun["hyperlink"];
  if (segment.hyperlink?.type === "URL") {
    hyperlink = { href: segment.hyperlink.value, target: "_blank" };
  }

  const fontPostScriptName = `${segment.fontName.family}-${segment.fontName.style.replace(/\s+/g, "")}`;

  return {
    start: segment.start,
    end: segment.end,
    text: segment.characters,
    fontName: fontPostScriptName,
    fontPostScriptName,
    fontSize: segment.fontSize,
    color,
    letterSpacing,
    capitalization,
    baselineShift: "normal",
    hyperlink,
  };
}

function resolveLeading(segment: FigmaTextSegment): number {
  if (segment.lineHeight.unit === "PIXELS") {
    return segment.lineHeight.value;
  }
  if (segment.lineHeight.unit === "PERCENT") {
    return segment.fontSize * (segment.lineHeight.value / 100);
  }
  return Math.round(segment.fontSize * 1.2 * 1000) / 1000;
}

export function segmentsToParagraph(
  segments: readonly FigmaTextSegment[],
  options: {
    alignment?: Paragraph["alignment"];
    direction?: Paragraph["direction"];
    spaceBefore?: number;
    spaceAfter?: number;
  } = {},
): Paragraph {
  if (segments.length === 0) {
    throw new Error("segmentsToParagraph() requires at least one Figma text segment.");
  }

  const runs = segments.map(segmentToRun);
  return {
    text: runs.map((run) => run.text).join(""),
    alignment: options.alignment ?? "left",
    direction: options.direction,
    leading: resolveLeading(segments[0]),
    spaceBefore: options.spaceBefore ?? 0,
    spaceAfter: options.spaceAfter ?? 0,
    runs,
  };
}

export function segmentsToParagraphs(
  segments: readonly FigmaTextSegment[],
  options: {
    alignment?: Paragraph["alignment"];
    direction?: Paragraph["direction"];
    spaceBefore?: number;
    spaceAfter?: number;
  } = {},
): Paragraph[] {
  if (segments.length === 0) {
    throw new Error("segmentsToParagraphs() requires at least one Figma text segment.");
  }

  const paragraphs: Paragraph[] = [];
  let current: FigmaTextSegment[] = [];

  const pushCurrent = () => {
    if (current.length === 0) {
      const leading = resolveLeading(segments[0]);
      paragraphs.push({
        text: "",
        alignment: options.alignment ?? "left",
        direction: options.direction,
        leading,
        spaceBefore: options.spaceBefore ?? 0,
        spaceAfter: options.spaceAfter ?? 0,
        runs: [
          {
            text: "",
            fontName: "System-Regular",
            fontSize: 16,
            color: { r: 0, g: 0, b: 0 },
            letterSpacing: 0,
            capitalization: "normal",
            baselineShift: "normal",
          },
        ],
      });
      return;
    }
    paragraphs.push(segmentsToParagraph(current, options));
    current = [];
  };

  for (const segment of segments) {
    const parts = segment.characters.split("\n");
    let cursor = segment.start;

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      current.push({
        ...segment,
        characters: part,
        start: cursor,
        end: cursor + part.length,
      });
      cursor += part.length;

      const isLast = index === parts.length - 1;
      if (!isLast) {
        pushCurrent();
        cursor += 1;
      }
    }
  }

  if (current.length > 0) {
    pushCurrent();
  }

  return paragraphs;
}
