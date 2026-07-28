import { z } from "zod";
import {
  SAFE_SETTING_IDENTIFIER_RE,
  SETTING_DEFINITIONS,
  type SettingDefinition,
} from "./settings-definitions.js";
import { CURRENT_IR_VERSION } from "./types.js";

/**
 * Every declared object below is `.strict()`: an unknown key is an error, not a
 * silent strip. The two deliberate exceptions are `MetadataSchema` and
 * `SourceMetadataSchema`, which are open by contract (`.catchall`). Zod itself
 * rejects `NaN` for `z.number()`, but `Infinity` passed every unbounded and
 * `positive()`/`min(0)` field, so number bases here are `.finite()`.
 */
const finiteNumber = z.number().finite();

// Recursive JSON-serializable value schema
const JsonLiteralSchema = z.union([z.string(), finiteNumber, z.boolean(), z.null()]);
type JsonValue = z.infer<typeof JsonLiteralSchema> | JsonValue[] | { [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonLiteralSchema, z.array(JsonValueSchema), z.record(JsonValueSchema)]),
);

const ColorSchema = z
  .object({
    r: finiteNumber.min(0).max(255),
    g: finiteNumber.min(0).max(255),
    b: finiteNumber.min(0).max(255),
    opacity: finiteNumber.min(0).max(100).optional(),
  })
  .strict();

const BoundingBoxSchema = z
  .object({
    x: finiteNumber,
    y: finiteNumber,
    width: finiteNumber,
    height: finiteNumber,
  })
  .strict();

const SourceMetadataSchema = z
  .object({
    tool: z.string().min(1),
    toolVersion: z.string().optional(),
    adapterVersion: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .catchall(JsonValueSchema);

export const CharacterRunSchema = z
  .object({
    text: z.string(),
    fontName: z.string(),
    fontPostScriptName: z.string().optional(),
    fontSize: finiteNumber.positive(),
    color: ColorSchema,
    letterSpacing: finiteNumber,
    capitalization: z.enum(["normal", "allcaps", "smallcaps"]),
    baselineShift: z.enum(["normal", "superscript", "subscript"]),
    hyperlink: z.object({ href: z.string(), target: z.string().optional() }).strict().optional(),
  })
  .strict();

const ParagraphSchema = z
  .object({
    text: z.string(),
    alignment: z.enum(["left", "center", "right", "justify"]),
    leading: finiteNumber.positive(),
    spaceBefore: finiteNumber.min(0),
    spaceAfter: finiteNumber.min(0),
    runs: z.array(CharacterRunSchema).min(1),
  })
  .strict()
  .refine((p) => p.text === p.runs.map((r) => r.text).join(""), {
    message: "Paragraph.text must equal concatenation of runs[].text",
  });

const DropShadowEffectSchema = z
  .object({
    type: z.literal("dropShadow"),
    offsetX: finiteNumber,
    offsetY: finiteNumber,
    blurRadius: finiteNumber.min(0),
    color: ColorSchema,
  })
  .strict();

const BlurEffectSchema = z
  .object({
    type: z.literal("blur"),
    radius: finiteNumber.min(0),
  })
  .strict();

const TextEffectSchema = z.discriminatedUnion("type", [DropShadowEffectSchema, BlurEffectSchema]);

/** CSS `matrix(a, b, c, d, e, f)` — exactly six finite numbers. */
const TransformMatrixSchema = z.tuple([
  finiteNumber,
  finiteNumber,
  finiteNumber,
  finiteNumber,
  finiteNumber,
  finiteNumber,
]);

const TextElementSchema = z
  .object({
    type: z.literal("text"),
    id: z.string().min(1),
    kind: z.enum(["point", "area"]),
    position: BoundingBoxSchema,
    rotation: finiteNumber.optional(),
    transformMatrix: TransformMatrixSchema.optional(),
    opacity: finiteNumber.min(0).max(100),
    blendMode: z.literal("multiply").optional(),
    valign: z.enum(["top", "middle", "bottom"]),
    paragraphs: z.array(ParagraphSchema).min(1),
    effects: z.array(TextEffectSchema).optional(),
    areaFill: ColorSchema.optional(),
    areaBorder: z
      .object({ width: finiteNumber.positive(), color: ColorSchema })
      .strict()
      .optional(),
    renderAs: z.enum(["html", "image"]),
    renderAsReason: z.enum(["rotation", "warp", "pathText", "imageOnly", "setting"]).optional(),
    binding: z
      .object({
        path: z.string().min(1),
        allowHtml: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

const ShapeElementSchema = z
  .object({
    type: z.literal("shape"),
    shapeType: z.enum(["rectangle", "circle", "line"]),
    id: z.string().optional(),
    position: BoundingBoxSchema,
    fill: ColorSchema.optional(),
    stroke: z.object({ width: finiteNumber.positive(), color: ColorSchema }).strict().optional(),
    opacity: finiteNumber.min(0).max(100),
    blendMode: z.literal("multiply").optional(),
    orientation: z.enum(["horizontal", "vertical"]).optional(),
  })
  .strict();

const VideoElementSchema = z
  .object({
    type: z.literal("video"),
    url: z.string().url().startsWith("https"),
  })
  .strict();

const RawHtmlElementSchema = z
  .object({
    type: z.literal("rawHtml"),
    content: z.string(),
  })
  .strict();

const SnippetElementSchema = z
  .object({
    type: z.literal("snippet"),
    key: z.string().min(1),
    position: BoundingBoxSchema,
  })
  .strict();

const ElementSchema = z.discriminatedUnion("type", [
  TextElementSchema,
  ShapeElementSchema,
  VideoElementSchema,
  RawHtmlElementSchema,
  SnippetElementSchema,
]);

export const LayerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    type: z.enum(["default", "svg", "png", "symbol", "div", "video", "html-before", "html-after"]),
    source: SourceMetadataSchema.optional(),
    // Optional and only meaningful on svg layers — enforced by the superRefine
    // below, deliberately NOT by widening LayerSchema into a discriminated
    // union: the hand-written types stay flat, and the one reader is already
    // inside `case "svg":` (html-tree.ts). Producers never write
    // `inlineSvg: false`; absent means "external SVG asset".
    inlineSvg: z.boolean().optional(),
    visible: z.boolean(),
    opacity: finiteNumber.min(0).max(100),
    elements: z.array(ElementSchema),
  })
  .strict()
  .superRefine((layer, ctx) => {
    if (layer.inlineSvg !== undefined && layer.type !== "svg") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inlineSvg"],
        message: `inlineSvg is only valid on svg layers; layer "${layer.id}" has type "${layer.type}".`,
      });
    }
  });

export const ArtboardSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    width: finiteNumber.positive(),
    height: finiteNumber.positive(),
    source: SourceMetadataSchema.optional(),
    responsiveness: z.enum(["fixed", "dynamic"]).optional(),
    layers: z.array(LayerSchema),
  })
  .strict();

export const FontMappingSchema = z
  .object({
    sourceFont: z.string().min(1),
    family: z.string().min(1),
    weight: z.string().optional(),
    style: z.string().optional(),
    vshift: z.string().optional(),
  })
  .strict();

const CustomBlockSchema = z
  .object({
    type: z.enum(["css", "js", "html", "html-before", "html-after"]),
    content: z.string(),
  })
  .strict();

export const AssetSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    mimeType: z.string().min(1),
    width: finiteNumber.positive(),
    height: finiteNumber.positive(),
    artboardId: z.string().min(1),
    // min(1): the semantic checks scope by presence while the emitter's index
    // scopes by truthiness, so `layerId: ""` would validate as a layer asset
    // and then silently occupy the background slot.
    layerId: z.string().min(1).optional(),
    altText: z.string().optional(),
    source: SourceMetadataSchema.optional(),
    exportParams: z
      .object({
        format: z.enum(["png", "png24", "jpg", "svg"]),
        scale: finiteNumber.positive(),
        transparent: z.boolean().optional(),
        quality: finiteNumber.optional(),
        colors: finiteNumber.optional(),
      })
      .strict(),
  })
  .strict();

// Single source of truth: defined in `settings-definitions.ts` so the Zod-free
// ExtendScript path can apply the same rule. Re-exported for existing importers.
export { SAFE_SETTING_IDENTIFIER_RE };

function settingSchemaFor(definition: SettingDefinition): z.ZodTypeAny {
  switch (definition.kind) {
    case "boolean":
      return z.boolean();
    case "string":
      return z.string();
    case "string-safe":
      return z.string().refine((value) => value === "" || SAFE_SETTING_IDENTIFIER_RE.test(value), {
        message:
          "Must be empty or a CSS-safe identifier using letters, numbers, underscores, or hyphens",
      });
    case "enum":
      return z.enum(definition.values as [string, ...string[]]);
    case "enum-array":
      return z.array(z.enum(definition.values as [string, ...string[]]));
    case "integer": {
      let schema = z.number().int();
      if (definition.min !== undefined) schema = schema.min(definition.min);
      if (definition.max !== undefined) schema = schema.max(definition.max);
      return schema;
    }
    case "positive-integer":
      return z.number().int().positive();
    case "positive-integer-nullable":
      return z.number().int().positive().nullable();
    case "positive-number-nullable":
      return z.number().finite().positive().nullable();
  }
}

export const SettingsSchema = z
  .object(
    Object.fromEntries(
      SETTING_DEFINITIONS.map((definition) => [definition.key, settingSchemaFor(definition)]),
    ),
  )
  .partial()
  .strict();

export const MetadataSchema = z
  .object({
    slug: z.string().min(1),
    lang: z.string().min(2).optional(),
    headline: z.string().optional(),
    leadin: z.string().optional(),
    summary: z.string().optional(),
    notes: z.string().optional(),
    sources: z.string().optional(),
    credit: z.string().optional(),
    altText: z.string().optional(),
    imageAltText: z.string().optional(),
    ariaRole: z.string().optional(),
  })
  .catchall(JsonValueSchema);

export const DocumentSchema = z
  .object({
    irVersion: z.literal(CURRENT_IR_VERSION),
    source: SourceMetadataSchema,
    settings: SettingsSchema,
    fonts: z.array(FontMappingSchema),
    artboards: z.array(ArtboardSchema).min(1),
    customBlocks: z.array(CustomBlockSchema),
    assets: z
      .record(AssetSchema)
      .refine((assets) => Object.entries(assets).every(([key, asset]) => key === asset.id), {
        message: "Asset record key must equal asset.id",
      }),
    metadata: MetadataSchema,
  })
  .strict()
  .superRefine((document, ctx) => {
    const artboardLayerIds = new Map<string, Set<string>>();

    document.artboards.forEach((artboard, artboardIndex) => {
      if (artboardLayerIds.has(artboard.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artboards", artboardIndex, "id"],
          message: `Duplicate artboard id "${artboard.id}".`,
        });
        return;
      }

      const layerIds = new Set<string>();
      artboard.layers.forEach((layer, layerIndex) => {
        if (layerIds.has(layer.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["artboards", artboardIndex, "layers", layerIndex, "id"],
            message: `Duplicate layer id "${layer.id}" in artboard "${artboard.id}".`,
          });
        }
        layerIds.add(layer.id);
      });
      artboardLayerIds.set(artboard.id, layerIds);

      // HTML-rendered text ids must be unique within an artboard: each one
      // becomes a DOM id in the emitted markup. Image-rendered text is exempt —
      // it produces no DOM node.
      const htmlTextIds = new Set<string>();
      artboard.layers.forEach((layer, layerIndex) => {
        layer.elements.forEach((element, elementIndex) => {
          if (element.type !== "text" || element.renderAs !== "html") return;
          if (htmlTextIds.has(element.id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [
                "artboards",
                artboardIndex,
                "layers",
                layerIndex,
                "elements",
                elementIndex,
                "id",
              ],
              message: `Duplicate html-rendered text element id "${element.id}" in artboard "${artboard.id}". Each becomes a DOM id, so it must be unique per artboard.`,
            });
          }
          htmlTextIds.add(element.id);
        });
      });
    });

    // Asset scopes are unique: at most one background asset per artboard, and
    // at most one asset per (artboardId, layerId). The emitters' scoped asset
    // index has exactly one slot per scope, so a second asset in the same scope
    // would be silently unreachable.
    const backgroundAssetByArtboard = new Map<string, string>();
    const layerAssetByScope = new Map<string, Map<string, string>>();

    for (const [assetKey, asset] of Object.entries(document.assets)) {
      const layerIds = artboardLayerIds.get(asset.artboardId);
      if (!layerIds) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", assetKey, "artboardId"],
          message: `Asset references unknown artboard id "${asset.artboardId}".`,
        });
        continue;
      }

      if (asset.layerId && !layerIds.has(asset.layerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", assetKey, "layerId"],
          message: `Asset references unknown layer id "${asset.layerId}" for artboard "${asset.artboardId}".`,
        });
        continue;
      }

      if (asset.layerId === undefined) {
        const existing = backgroundAssetByArtboard.get(asset.artboardId);
        if (existing !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["assets", assetKey],
            message: `Artboard "${asset.artboardId}" has more than one background asset ("${existing}" and "${assetKey}").`,
          });
        } else {
          backgroundAssetByArtboard.set(asset.artboardId, assetKey);
        }
      } else {
        let byLayer = layerAssetByScope.get(asset.artboardId);
        if (!byLayer) {
          byLayer = new Map<string, string>();
          layerAssetByScope.set(asset.artboardId, byLayer);
        }
        const existing = byLayer.get(asset.layerId);
        if (existing !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["assets", assetKey],
            message: `Layer "${asset.layerId}" on artboard "${asset.artboardId}" has more than one asset ("${existing}" and "${assetKey}").`,
          });
        } else {
          byLayer.set(asset.layerId, assetKey);
        }
      }
    }

    document.artboards.forEach((artboard, artboardIndex) => {
      // A visible png layer, or a visible svg layer that is not inlined, renders
      // as an <img> whose src is its layer asset. Without the asset the layer is
      // a silent hole at page-view time — which is also how a validator-dropped
      // asset record or a failed raster export would otherwise surface.
      artboard.layers.forEach((layer, layerIndex) => {
        if (layer.visible === false) return;
        const needsLayerAsset =
          layer.type === "png" || (layer.type === "svg" && layer.inlineSvg !== true);
        if (!needsLayerAsset) return;
        if (layerAssetByScope.get(artboard.id)?.has(layer.id)) return;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artboards", artboardIndex, "layers", layerIndex],
          message: `Visible ${layer.type} layer "${layer.id}" on artboard "${artboard.id}" has no asset. A ${layer.type} layer renders from its layer asset, so this layer would be missing from the page.`,
        });
      });

      // Image-rendered text lives only in the artboard's background raster, so
      // a missing background asset makes that text appear zero times. Invisible
      // layers are exempt, matching the visible-layer asset check above: their
      // content produces nothing, so nothing can be missing.
      const hasImageText = artboard.layers.some(
        (layer) =>
          layer.visible !== false &&
          layer.elements.some((element) => element.type === "text" && element.renderAs === "image"),
      );
      if (hasImageText && !backgroundAssetByArtboard.has(artboard.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artboards", artboardIndex],
          message: `Artboard "${artboard.id}" contains renderAs: "image" text but has no background asset. Image-rendered text exists only in the background raster, so it would appear nowhere.`,
        });
      }
    });
  });

export type DocumentInput = z.input<typeof DocumentSchema>;
