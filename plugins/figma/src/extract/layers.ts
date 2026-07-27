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
  { token: ":video", type: "video" },
];

/**
 * Tokens the canonical IR defines and Illustrator honors, which the Figma
 * runtime has no implementation for.
 *
 * These used to be in `matches`, which made the parser claim a `symbol`/`div`
 * layer it then refused three files later — the parser advertised what the
 * runtime would not do. They are now reported as unsupported at the point of
 * recognition, so the layer exports as ordinary artwork *and* the user is told
 * why, instead of the tag being silently accepted or silently ignored.
 */
const UNSUPPORTED_TOKENS = [":symbol", ":div"] as const;

export type UnsupportedLayerToken = (typeof UNSUPPORTED_TOKENS)[number];

export interface ParsedLayerType {
  type: LayerType;
  cleanName: string;
  inlineSvg: boolean;
  /** Set when the name carries a tag the Figma runtime cannot honor. */
  unsupportedToken?: UnsupportedLayerToken;
}

export function parseLayerType(name: string): ParsedLayerType {
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

  for (const token of UNSUPPORTED_TOKENS) {
    if (lower.startsWith(token) || lower.endsWith(token)) {
      return { type: "default", cleanName: name, inlineSvg: false, unsupportedToken: token };
    }
  }

  return { type: "default", cleanName: name, inlineSvg: false };
}
