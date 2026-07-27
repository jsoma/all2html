/**
 * Selection and frame detection for the Figma input plugin.
 * Figma v1 export roots are selected top-level frames only.
 */

import { FigmaPluginError } from "../errors.js";
import type {
  ExtractedFrame,
  FrameGroup,
  FrameInfo,
  FrameSelectionNodeLike,
  SelectionNodeLike,
} from "../types.js";

/**
 * Image-only frame tokens.
 *
 * `image-only` is the documented spelling — it matches the IR field
 * (`Artboard.imageOnly`) and the vocabulary used everywhere else in the docs.
 * `image` is the spelling this parser shipped with, so it stays accepted; a
 * frame already named `story:image` in a live file must not silently start
 * exporting live text.
 */
const IMAGE_ONLY_TOKENS = ["image-only", "image"];

export const DOCUMENTED_IMAGE_ONLY_TOKEN = IMAGE_ONLY_TOKENS[0];

export function parseFrameName(rawName: string): {
  name: string;
  widthOverride?: number;
  responsiveness?: "fixed" | "dynamic";
  imageOnly?: boolean;
} {
  const parts = rawName.split(":");
  const name = parts[0].trim();
  let widthOverride: number | undefined;
  let responsiveness: "fixed" | "dynamic" | undefined;
  let imageOnly = false;

  for (let i = 1; i < parts.length; i++) {
    const annotation = parts[i].trim().toLowerCase();
    if (annotation === "dynamic") {
      responsiveness = "dynamic";
    } else if (annotation === "fixed") {
      responsiveness = "fixed";
    } else if (IMAGE_ONLY_TOKENS.indexOf(annotation) !== -1) {
      imageOnly = true;
    } else {
      const num = Number.parseInt(annotation, 10);
      if (!Number.isNaN(num) && num > 0) {
        widthOverride = num;
      }
    }
  }

  return { name, widthOverride, responsiveness, imageOnly };
}

export function isTopLevelFrame(node: SelectionNodeLike): node is FrameSelectionNodeLike {
  return node.type === "FRAME" && node.parent?.type === "PAGE";
}

export function extractFrameInfo(frame: FrameSelectionNodeLike): FrameInfo {
  const parsed = parseFrameName(frame.name);
  return {
    sourceNodeId: frame.id,
    name: parsed.name,
    originalName: frame.name,
    width: parsed.widthOverride ?? frame.width,
    height: frame.height,
    widthOverride: parsed.widthOverride,
    responsiveness: parsed.responsiveness,
    imageOnly: parsed.imageOnly,
  };
}

export function getSelectedTopLevelFrames(
  selection: readonly SelectionNodeLike[],
): FrameSelectionNodeLike[] {
  if (selection.length === 0) {
    throw new FigmaPluginError("Select one or more top-level frames before exporting.");
  }

  const invalid = selection.filter((node) => !isTopLevelFrame(node));
  if (invalid.length > 0) {
    const labels = invalid.map((node) => `"${node.name}" (${node.type})`).join(", ");
    throw new FigmaPluginError(
      `Figma export only supports selected top-level frames in v1. Invalid selection: ${labels}`,
    );
  }

  return selection as FrameSelectionNodeLike[];
}

export function groupFrameInfos(frames: readonly FrameInfo[]): FrameGroup[] {
  const groups = new Map<string, FrameInfo[]>();
  for (const frame of frames) {
    const bucket = groups.get(frame.name);
    if (bucket) {
      bucket.push(frame);
    } else {
      groups.set(frame.name, [frame]);
    }
  }

  const result: FrameGroup[] = [];
  groups.forEach((groupFrames, name) => {
    const sorted = [...groupFrames].sort((a, b) => a.width - b.width);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].width === sorted[i].width) {
        throw new FigmaPluginError(
          `Responsive Figma variants for "${name}" must have unique widths. Found duplicate width ${sorted[i].width}.`,
        );
      }
    }
    result.push({ name, frames: sorted });
  });

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function validateExtractedFrames(frames: readonly ExtractedFrame[]): ExtractedFrame[] {
  if (frames.length === 0) {
    throw new FigmaPluginError("No extracted Figma frames were provided for export.");
  }

  groupFrameInfos(frames);
  return [...frames];
}
