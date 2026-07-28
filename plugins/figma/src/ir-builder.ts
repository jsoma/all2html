/**
 * Canonical IR builder for the Figma input plugin.
 * This module is the boundary between Figma-specific extraction and the core pipeline.
 */

import type {
  Artboard,
  Asset,
  Document,
  FontMapping,
  Metadata,
  Settings,
} from "../../../src/ir/types.js";
import { CURRENT_IR_VERSION } from "../../../src/ir/types.js";
import { loadAndValidateIR } from "../../../src/ir/validate.js";
import { FigmaPluginError } from "./errors.js";
import { validateExtractedFrames } from "./extract/frames.js";
import { figmaSourceFontToMapping } from "./extract/text.js";
import { makeFigmaArtboardId, makeFigmaLayerId } from "./ir-ids.js";
import type { ExtractedAsset, ExtractedFrame } from "./types.js";

function mergeAssets(
  frames: readonly ExtractedFrame[],
  explicitAssets?: Record<string, Asset>,
): Record<string, Asset> {
  const assets: Record<string, Asset> = explicitAssets ? { ...explicitAssets } : {};

  for (const frame of frames) {
    for (const asset of frame.assets ?? []) {
      // Last-wins overwriting silently dropped an asset whenever two ids
      // collided (the failure §3.2 fixed at the producer by deriving ids from
      // owner ids). A collision reaching this point is a bug, so it throws.
      if (Object.hasOwn(assets, asset.id)) {
        throw new FigmaPluginError(
          `Duplicate asset id "${asset.id}". Every extracted asset needs its own id; overwriting would silently drop one asset from the export.`,
        );
      }
      assets[asset.id] = stripAssetBytes(asset);
    }
  }

  return assets;
}

function addFontMapping(target: Map<string, FontMapping>, mapping: FontMapping | null): void {
  if (!mapping) {
    return;
  }
  target.set(mapping.sourceFont, mapping);
}

function collectFigmaFontMappings(frames: readonly ExtractedFrame[]): FontMapping[] {
  const mappings = new Map<string, FontMapping>();

  for (const frame of frames) {
    for (const mapping of frame.fonts ?? []) {
      addFontMapping(mappings, mapping);
    }

    for (const layer of frame.layers) {
      for (const element of layer.elements) {
        if (element.type !== "text") {
          continue;
        }
        for (const paragraph of element.paragraphs) {
          for (const run of paragraph.runs) {
            addFontMapping(
              mappings,
              figmaSourceFontToMapping(run.fontPostScriptName ?? run.fontName),
            );
          }
        }
      }
    }
  }

  return [...mappings.values()];
}

function mergeFontMappings(...sources: Array<readonly FontMapping[] | undefined>): FontMapping[] {
  const merged = new Map<string, FontMapping>();
  for (const source of sources) {
    for (const mapping of source ?? []) {
      merged.set(mapping.sourceFont, mapping);
    }
  }
  return [...merged.values()];
}

function stripAssetBytes(asset: ExtractedAsset): Asset {
  const { bytes: _bytes, sourceNodeId: _sourceNodeId, ...canonicalAsset } = asset;
  return canonicalAsset;
}

export function buildArtboard(frame: ExtractedFrame): Artboard {
  const artboardId = makeFigmaArtboardId(frame);
  return {
    id: artboardId,
    name: frame.name,
    width: frame.width,
    height: frame.height,
    source: {
      tool: "figma",
      id: frame.sourceNodeId,
      name: frame.originalName,
      width: frame.actualWidth,
      height: frame.actualHeight,
    },
    // Omitted, not set to undefined: the document model must survive a JSON
    // round-trip, and assertJsonPure enforces that per transform.
    ...(frame.responsiveness === undefined ? {} : { responsiveness: frame.responsiveness }),
    ...(frame.imageOnly === undefined ? {} : { imageOnly: frame.imageOnly }),
    layers: frame.layers.map((layer) => ({
      id: makeFigmaLayerId(frame, layer),
      name: layer.name,
      type: layer.type,
      source: {
        tool: "figma",
        id: layer.sourceNodeId,
        name: layer.name,
      },
      inlineSvg: layer.inlineSvg,
      visible: layer.visible,
      opacity: layer.opacity,
      elements: [...layer.elements],
    })),
  };
}

export function buildDocument(
  frames: readonly ExtractedFrame[],
  options: {
    slug: string;
    pluginVersion?: string;
    figmaVersion?: string;
    settings?: Partial<Settings>;
    metadata?: Partial<Metadata>;
    fonts?: FontMapping[];
    customBlocks?: Document["customBlocks"];
    assets?: Record<string, Asset>;
  },
): Document {
  const validatedFrames = validateExtractedFrames(frames);
  const fontMappings = mergeFontMappings(collectFigmaFontMappings(validatedFrames), options.fonts);
  const doc = {
    irVersion: CURRENT_IR_VERSION,
    source: {
      tool: "figma",
      toolVersion: options.figmaVersion ?? "unknown",
      adapterVersion: options.pluginVersion ?? "0.1.0",
    },
    settings: { ...(options.settings ?? {}) },
    fonts: fontMappings,
    artboards: validatedFrames.map(buildArtboard),
    customBlocks: [...(options.customBlocks ?? [])],
    assets: mergeAssets(validatedFrames, options.assets),
    metadata: {
      slug: options.slug,
      ...(options.metadata ?? {}),
    },
  } satisfies Document;

  return loadAndValidateIR(doc);
}
