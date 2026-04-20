/**
 * Canonical IR builder for the Figma input plugin.
 * This module is the boundary between Figma-specific extraction and the core pipeline.
 */

import type { Artboard, Asset, Document, FontMapping, Metadata, Settings } from "../../../src/ir/types.js";
import { loadAndValidateIR } from "../../../src/ir/validate.js";
import { validateExtractedFrames } from "./extract/frames.js";
import type { ExtractedAsset, ExtractedFrame } from "./types.js";

function mergeAssets(frames: readonly ExtractedFrame[], explicitAssets?: Record<string, Asset>): Record<string, Asset> {
  const assets: Record<string, Asset> = explicitAssets ? { ...explicitAssets } : {};

  for (const frame of frames) {
    for (const asset of frame.assets ?? []) {
      assets[asset.id] = stripAssetBytes(asset);
    }
  }

  return assets;
}

function stripAssetBytes(asset: ExtractedAsset): Asset {
  const { bytes: _bytes, sourceNodeId: _sourceNodeId, ...canonicalAsset } = asset;
  return canonicalAsset;
}

export function buildArtboard(frame: ExtractedFrame): Artboard {
  return {
    name: frame.name,
    originalName: frame.originalName,
    width: frame.width,
    height: frame.height,
    actualWidth: frame.actualWidth,
    actualHeight: frame.actualHeight,
    responsiveness: frame.responsiveness,
    imageOnly: frame.imageOnly,
    layers: frame.layers.map((layer) => ({
      name: layer.name,
      type: layer.type,
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
  const doc = {
    irVersion: "0.0.0",
    generator: {
      tool: "figma",
      toolVersion: options.figmaVersion ?? "unknown",
      pluginVersion: options.pluginVersion ?? "0.1.0",
    },
    settings: { ...(options.settings ?? {}) },
    fonts: [...(options.fonts ?? [])],
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
