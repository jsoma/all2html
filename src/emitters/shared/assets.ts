import type { Asset, EmitterReadyArtboard, Settings } from "../../ir/types.js";

export const ASSET_PATH_TOKEN = "%%ASSET_PATH%%";

export interface ScopedAssetIndex {
  byArtboard: Record<string, Asset>;
  byArtboardLayer: Record<string, Asset>;
}

function makeArtboardScopedKey(
  artboard: Pick<EmitterReadyArtboard, "name" | "originalName" | "width" | "height">,
): string {
  return `${artboard.name}\u0000${artboard.originalName}\u0000${artboard.width}\u0000${artboard.height}`;
}

function resolveScopedArtboardKey(
  assetArtboardName: string,
  artboardsByName: Record<string, string[]>,
  artboardsByOriginalName: Record<string, string[]>,
  cursors: Record<string, number>,
  cursorKey: string,
): string | undefined {
  const originalMatches = artboardsByOriginalName[assetArtboardName];
  if (originalMatches?.length === 1) {
    return originalMatches[0];
  }

  const nameMatches = artboardsByName[assetArtboardName];
  const matches = nameMatches?.length ? nameMatches : originalMatches;
  if (!matches?.length) {
    return undefined;
  }
  if (matches.length === 1) {
    return matches[0];
  }

  const idx = cursors[cursorKey] ?? 0;
  cursors[cursorKey] = idx + 1;
  return matches[Math.min(idx, matches.length - 1)];
}

export function buildScopedAssetIndex(
  artboards: readonly Pick<EmitterReadyArtboard, "name" | "originalName" | "width" | "height">[],
  assets: Record<string, Asset>,
): ScopedAssetIndex {
  const byArtboard: Record<string, Asset> = {};
  const byArtboardLayer: Record<string, Asset> = {};
  const artboardsByName: Record<string, string[]> = {};
  const artboardsByOriginalName: Record<string, string[]> = {};

  for (const artboard of artboards) {
    const key = makeArtboardScopedKey(artboard);
    if (!artboardsByName[artboard.name]) {
      artboardsByName[artboard.name] = [];
    }
    artboardsByName[artboard.name].push(key);
    if (artboard.originalName) {
      if (!artboardsByOriginalName[artboard.originalName]) {
        artboardsByOriginalName[artboard.originalName] = [];
      }
      artboardsByOriginalName[artboard.originalName].push(key);
    }
  }

  const artboardCursors: Record<string, number> = {};
  const layerCursors: Record<string, number> = {};

  for (const asset of Object.values(assets)) {
    const cursorKey = asset.layerName
      ? `${asset.artboardName}\u0000${asset.layerName}`
      : asset.artboardName;
    const scopedKey = resolveScopedArtboardKey(
      asset.artboardName,
      artboardsByName,
      artboardsByOriginalName,
      asset.layerName ? layerCursors : artboardCursors,
      cursorKey,
    );
    if (!scopedKey) continue;

    if (!asset.layerName) {
      byArtboard[scopedKey] = asset;
    } else {
      byArtboardLayer[`${scopedKey}:${asset.layerName}`] = asset;
    }
  }

  return { byArtboard, byArtboardLayer };
}

export function getScopedArtboardAsset(
  assetIdx: ScopedAssetIndex,
  artboard: Pick<EmitterReadyArtboard, "name" | "originalName" | "width" | "height">,
): Asset | undefined {
  return assetIdx.byArtboard[makeArtboardScopedKey(artboard)];
}

export function getScopedLayerAsset(
  assetIdx: ScopedAssetIndex,
  artboard: Pick<EmitterReadyArtboard, "name" | "originalName" | "width" | "height">,
  layerName: string,
): Asset | undefined {
  return assetIdx.byArtboardLayer[`${makeArtboardScopedKey(artboard)}:${layerName}`];
}

/**
 * Resolve an asset path using the settings.
 * Used by HTML emitter for <img src="...">.
 */
export function resolveAssetPath(asset: Asset, settings: Settings): string {
  const basePath = settings.imageSourcePath || settings.imageOutputPath || "";
  let path = asset.path;
  if (basePath && !path.startsWith(basePath)) {
    path = basePath + path;
  }
  if (settings.cacheBustToken != null) {
    path += `?v=${settings.cacheBustToken}`;
  }
  return path;
}

/**
 * Create a tokenized asset path using %%ASSET_PATH%% token.
 * Used by Svelte/React emitters where the path is resolved at runtime via a prop.
 */
export function tokenizedAssetPath(asset: Asset, settings: Settings): string {
  let path = `${ASSET_PATH_TOKEN}/${asset.path}`;
  if (settings.cacheBustToken != null) {
    path += `?v=${settings.cacheBustToken}`;
  }
  return path;
}

/**
 * Replace %%ASSET_PATH%% tokens in a string with a concrete path.
 */
export function replaceAssetPathToken(str: string, assetsPath: string): string {
  return str.split(ASSET_PATH_TOKEN).join(assetsPath);
}

/**
 * Convert an asset path to a CSS url("...") value with basic string escaping.
 * Used by emitters when CSS custom property image mode is enabled.
 */
export function toCssUrlValue(path: string): string {
  const escaped = path
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\f/g, "\\f");
  return `url("${escaped}")`;
}
