import { artifactRelativePath } from "../../core/artifact-path.js";
import { hasOwn, opaqueKey } from "../../core/identifiers.js";
import {
  createWarning,
  pushUniqueStructuredWarning,
  type StructuredWarning,
} from "../../core/warnings.js";
import type { Asset, EmitterReadyArtboard, Settings } from "../../ir/types.js";

/**
 * All keys are `opaqueKey()`-guarded (see `src/core/identifiers.js`): an
 * artboard or layer id named `__proto__` must be ordinary data, not a prototype
 * hit. The layer scope is a nested record rather than an `artboardId:layerId`
 * concatenation — both shipped ID schemes embed `:`, so `("a:b","c")` and
 * `("a","b:c")` used to meet in one namespace.
 */
export interface ScopedAssetIndex {
  byArtboard: Record<string, Asset>;
  byArtboardLayer: Record<string, Record<string, Asset>>;
}

export function buildScopedAssetIndex(
  artboards: readonly Pick<EmitterReadyArtboard, "id">[],
  assets: Record<string, Asset>,
): ScopedAssetIndex {
  const byArtboard: Record<string, Asset> = {};
  const byArtboardLayer: Record<string, Record<string, Asset>> = {};
  const artboardIds: Record<string, true> = {};
  for (const artboard of artboards) {
    artboardIds[opaqueKey(artboard.id)] = true;
  }

  for (const asset of Object.values(assets)) {
    const artboardKey = opaqueKey(asset.artboardId);
    if (!hasOwn(artboardIds, artboardKey)) continue;

    if (!asset.layerId) {
      byArtboard[artboardKey] = asset;
    } else {
      if (!hasOwn(byArtboardLayer, artboardKey)) {
        byArtboardLayer[artboardKey] = {};
      }
      byArtboardLayer[artboardKey][opaqueKey(asset.layerId)] = asset;
    }
  }

  return { byArtboard, byArtboardLayer };
}

export function getScopedArtboardAsset(
  assetIdx: ScopedAssetIndex,
  artboard: Pick<EmitterReadyArtboard, "id">,
): Asset | undefined {
  const key = opaqueKey(artboard.id);
  return hasOwn(assetIdx.byArtboard, key) ? assetIdx.byArtboard[key] : undefined;
}

export function getScopedLayerAsset(
  assetIdx: ScopedAssetIndex,
  artboard: Pick<EmitterReadyArtboard, "id">,
  layerId: string,
): Asset | undefined {
  const artboardKey = opaqueKey(artboard.id);
  if (!hasOwn(assetIdx.byArtboardLayer, artboardKey)) return undefined;
  const layerAssets = assetIdx.byArtboardLayer[artboardKey];
  const layerKey = opaqueKey(layerId);
  return hasOwn(layerAssets, layerKey) ? layerAssets[layerKey] : undefined;
}

/**
 * The one asset-URL join rule: exactly one `/` between a non-empty base and the
 * asset path. A base without a trailing slash used to concatenate verbatim
 * (`img` + `chart.png` → `imgchart.png`, a silent 404); a base that is all
 * slashes (site root `/`) keeps its one slash. ES3-safe.
 */
export function joinAssetBase(base: string, path: string): string {
  if (!base) return path;
  let end = base.length;
  while (end > 0 && base.charAt(end - 1) === "/") end--;
  return base.slice(0, end) + "/" + path;
}

/**
 * The runtime half of the same rule, as generated-component source. The emitted
 * markup carries `ASSETS_TOKEN + "/"` (see `component-tree.ts`), so the
 * component's job is to reduce the user-supplied base to no trailing slash
 * before token replacement — together that is `joinAssetBase`. Svelte and React
 * both inline this expression so the two runtimes and `resolveAssetPath`
 * cannot drift.
 */
export function assetBaseJoinRuntimeExpression(baseVarName: string): string {
  return `${baseVarName}.replace(/\\/+$/, "")`;
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
 * `src` was `assets//x.png` while the ZIP held `assets/x.png`. The base is a URL
 * the user may deliberately point somewhere the bundle layout does not describe;
 * it is joined with `joinAssetBase()` — exactly one `/` between base and path —
 * because a base missing its trailing slash used to concatenate into
 * `imgchart.png`, a silent 404.
 *
 * A base containing `?` or `#` gets a structured warning (`asset:base-query`):
 * the `?v=` cache-bust append is unconditional, so such a base would produce a
 * double query string.
 */
export function resolveAssetPath(
  asset: Asset,
  settings: Settings,
  assetBase?: string,
  warnings?: StructuredWarning[],
): string {
  const basePath = settings.imageSourcePath || assetBase || "";
  let path = artifactRelativePath(asset.path);
  if (basePath) {
    if (warnings && (basePath.indexOf("?") !== -1 || basePath.indexOf("#") !== -1)) {
      pushUniqueStructuredWarning(
        warnings,
        createWarning(
          "asset:base-query",
          "image",
          'Asset base path "' +
            basePath +
            '" contains "?" or "#"; the appended cache-bust query (?v=...) and asset path will not resolve as intended.',
        ),
      );
    }
    path = joinAssetBase(basePath, path);
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
