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
 * The `<img src>` / CSS `url()` value for an asset.
 *
 * Two inputs, and they answer different questions:
 *
 *   - `settings.imageSourcePath` — the **user's** answer. Used verbatim when
 *     set, because the user is deliberately pointing at a URL that need not
 *     match the on-disk layout at all: a CDN, a site root, a build output
 *     directory. ai2html splits these for exactly that reason
 *     (`image_output_path` is a filesystem directory, `image_source_path` is
 *     the `<img src>` prefix), and the NYT configs ship them set to different
 *     values.
 *   - `assetBase` — the **surface's** answer: where the surface writes the
 *     assets relative to the emitted file. Supplied as an emitter option (see
 *     `withAssetBase` in `../types.js`), never inferred here.
 *
 * `settings.imageOutputPath` deliberately does not appear. It is where the
 * *files* go, which is only the same string as the `src` prefix on surfaces
 * that put the emitted file at the root of that layout — true for the
 * bundle-producing surfaces, false for Illustrator, which writes the HTML into
 * the image directory itself. Reading it here was that guess, and it 404'd
 * every image on every live Illustrator export.
 *
 * The base is concatenated unconditionally: `createOutputBundle()` joins
 * `assetRoot + asset.path` with no "already prefixed?" test, and the two have
 * to produce the same string or the HTML references entries the bundle does not
 * contain.
 */
export function resolveAssetPath(asset: Asset, settings: Settings, assetBase?: string): string {
  const basePath = settings.imageSourcePath || assetBase || "";
  let path = asset.path;
  if (basePath) {
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
