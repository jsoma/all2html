import { artifactRelativePath } from "../../core/artifact-path.js";
import type { Asset, EmitterReadyArtboard, Settings } from "../../ir/types.js";

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
 *
 * That agreement is why `asset.path` goes through `artifactRelativePath()` — the
 * **same** constructor bundle assembly builds its entry from, not a second copy
 * of the rule. The schema only requires `Asset.path` to be non-empty, so `/x.png`
 * and `a//b.png` are valid IR; spelled here and normalized there, the emitted
 * `src` was `assets//x.png` while the ZIP held `assets/x.png`. The base is still
 * concatenated verbatim, because `imageSourcePath` is a URL the user is
 * deliberately pointing somewhere the bundle layout does not describe.
 */
export function resolveAssetPath(asset: Asset, settings: Settings, assetBase?: string): string {
  const basePath = settings.imageSourcePath || assetBase || "";
  let path = artifactRelativePath(asset.path);
  if (basePath) {
    path = basePath + path;
  }
  if (settings.cacheBustToken != null) {
    path += `?v=${settings.cacheBustToken}`;
  }
  return path;
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
