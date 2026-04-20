/**
 * Layer type detection from naming conventions.
 * Figma v1 only recognizes layer types that already exist in the canonical IR.
 */

import type { LayerType } from "../../../../src/ir/types.js";

interface LayerTypeMatch {
  token: string;
  type: LayerType;
  inlineSvg?: boolean;
}

const matches: LayerTypeMatch[] = [
  { token: ":html-before", type: "html-before" },
  { token: ":html-after", type: "html-after" },
  { token: ":svg:inline", type: "svg", inlineSvg: true },
  { token: ":svg", type: "svg" },
  { token: ":png", type: "png" },
  { token: ":symbol", type: "symbol" },
  { token: ":div", type: "div" },
  { token: ":video", type: "video" },
];

export function parseLayerType(name: string): { type: LayerType; cleanName: string; inlineSvg: boolean } {
  const lower = name.toLowerCase().trim();

  for (const match of matches) {
    if (lower.startsWith(match.token)) {
      return {
        type: match.type,
        cleanName: name.slice(match.token.length).trim() || name,
        inlineSvg: match.inlineSvg ?? false,
      };
    }

    if (lower.endsWith(match.token)) {
      return {
        type: match.type,
        cleanName: name.slice(0, -match.token.length).trim() || name,
        inlineSvg: match.inlineSvg ?? false,
      };
    }
  }

  return { type: "default", cleanName: name, inlineSvg: false };
}
