import type { Asset, EmitterReadyArtboard, Settings } from "../../ir/types.js";

export const ASSET_PATH_TOKEN = "%%ASSET_PATH%%";

export interface ScopedAssetIndex {
  byArtboard: Record<string, Asset>;
  byArtboardLayer: Record<string, Asset>;
}

function makeArtboardScopedKey(artboard: Pick<EmitterReadyArtboard, "id">): string {
  return artboard.id;
}

export function buildScopedAssetIndex(
  artboards: readonly Pick<EmitterReadyArtboard, "id">[],
  assets: Record<string, Asset>,
): ScopedAssetIndex {
  const byArtboard: Record<string, Asset> = {};
  const byArtboardLayer: Record<string, Asset> = {};
  const artboardIds: Record<string, true> = {};
  for (const artboard of artboards) {
    artboardIds[`$${artboard.id}`] = true;
  }

  for (const asset of Object.values(assets)) {
    if (!artboardIds[`$${asset.artboardId}`]) continue;
    const scopedKey = asset.artboardId;

    if (!asset.layerId) {
      byArtboard[scopedKey] = asset;
    } else {
      byArtboardLayer[`${scopedKey}:${asset.layerId}`] = asset;
    }
  }

  return { byArtboard, byArtboardLayer };
}

export function getScopedArtboardAsset(
  assetIdx: ScopedAssetIndex,
  artboard: Pick<EmitterReadyArtboard, "id">,
): Asset | undefined {
  return assetIdx.byArtboard[makeArtboardScopedKey(artboard)];
}

export function getScopedLayerAsset(
  assetIdx: ScopedAssetIndex,
  artboard: Pick<EmitterReadyArtboard, "id">,
  layerId: string,
): Asset | undefined {
  return assetIdx.byArtboardLayer[`${makeArtboardScopedKey(artboard)}:${layerId}`];
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
