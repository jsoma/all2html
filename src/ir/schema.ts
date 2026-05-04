import { z } from "zod";
import { SETTING_DEFINITIONS, type SettingDefinition } from "./settings-definitions.js";
import { CURRENT_IR_VERSION } from "./types.js";

// Recursive JSON-serializable value schema
const JsonLiteralSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
type JsonValue = z.infer<typeof JsonLiteralSchema> | JsonValue[] | { [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonLiteralSchema, z.array(JsonValueSchema), z.record(JsonValueSchema)]),
);

const ColorSchema = z.object({
  r: z.number().min(0).max(255),
  g: z.number().min(0).max(255),
  b: z.number().min(0).max(255),
  opacity: z.number().min(0).max(100).optional(),
});

const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const SourceMetadataSchema = z
  .object({
    tool: z.string().min(1),
    toolVersion: z.string().optional(),
    adapterVersion: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .catchall(JsonValueSchema);

export const CharacterRunSchema = z.object({
  text: z.string(),
  fontName: z.string(),
  fontPostScriptName: z.string().optional(),
  fontSize: z.number().positive(),
  color: ColorSchema,
  letterSpacing: z.number(),
  capitalization: z.enum(["normal", "allcaps", "smallcaps"]),
  baselineShift: z.enum(["normal", "superscript", "subscript"]),
  hyperlink: z.object({ href: z.string(), target: z.string().optional() }).optional(),
});

const ParagraphSchema = z
  .object({
    text: z.string(),
    alignment: z.enum(["left", "center", "right", "justify"]),
    direction: z.enum(["ltr", "rtl"]).optional(),
    leading: z.number().positive(),
    spaceBefore: z.number().min(0),
    spaceAfter: z.number().min(0),
    runs: z.array(CharacterRunSchema).min(1),
  })
  .refine((p) => p.text === p.runs.map((r) => r.text).join(""), {
    message: "Paragraph.text must equal concatenation of runs[].text",
  });

const DropShadowEffectSchema = z.object({
  type: z.literal("dropShadow"),
  offsetX: z.number(),
  offsetY: z.number(),
  blurRadius: z.number().min(0),
  color: ColorSchema,
});

const BlurEffectSchema = z.object({
  type: z.literal("blur"),
  radius: z.number().min(0),
});

const TextEffectSchema = z.discriminatedUnion("type", [DropShadowEffectSchema, BlurEffectSchema]);

const TextElementSchema = z.object({
  type: z.literal("text"),
  id: z.string().min(1),
  kind: z.enum(["point", "area"]),
  position: BoundingBoxSchema,
  rotation: z.number().optional(),
  transformMatrix: z.array(z.number()).length(6).optional(),
  opacity: z.number().min(0).max(100),
  blendMode: z.literal("multiply").optional(),
  valign: z.enum(["top", "middle", "bottom"]),
  paragraphs: z.array(ParagraphSchema).min(1),
  effects: z.array(TextEffectSchema).optional(),
  areaFill: ColorSchema.optional(),
  areaBorder: z.object({ width: z.number().positive(), color: ColorSchema }).optional(),
  renderAs: z.enum(["html", "image"]),
  renderAsReason: z.enum(["rotation", "warp", "pathText", "imageOnly", "setting"]).optional(),
  dataAttributes: z.record(z.string()).optional(),
  binding: z
    .object({
      path: z.string().min(1),
      allowHtml: z.boolean(),
    })
    .optional(),
});

const ShapeElementSchema = z.object({
  type: z.literal("shape"),
  shapeType: z.enum(["rectangle", "circle", "line"]),
  id: z.string().optional(),
  position: BoundingBoxSchema,
  fill: ColorSchema.optional(),
  stroke: z.object({ width: z.number().positive(), color: ColorSchema }).optional(),
  opacity: z.number().min(0).max(100),
  blendMode: z.literal("multiply").optional(),
  orientation: z.enum(["horizontal", "vertical"]).optional(),
  segments: z
    .array(
      z.object({
        x1: z.number(),
        y1: z.number(),
        x2: z.number(),
        y2: z.number(),
      }),
    )
    .optional(),
});

const VideoElementSchema = z.object({
  type: z.literal("video"),
  url: z.string().url().startsWith("https"),
});

const RawHtmlElementSchema = z.object({
  type: z.literal("rawHtml"),
  content: z.string(),
});

const SnippetElementSchema = z.object({
  type: z.literal("snippet"),
  key: z.string().min(1),
  group: z.string().optional(),
  position: BoundingBoxSchema,
  geometry: z.object({ kind: z.enum(["rectangle", "circle", "line"]) }).optional(),
  visible: z.boolean().optional(),
});

const ElementSchema = z.discriminatedUnion("type", [
  TextElementSchema,
  ShapeElementSchema,
  VideoElementSchema,
  RawHtmlElementSchema,
  SnippetElementSchema,
]);

export const LayerSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(["default", "svg", "png", "symbol", "div", "video", "html-before", "html-after"]),
  source: SourceMetadataSchema.optional(),
  inlineSvg: z.boolean(),
  visible: z.boolean(),
  opacity: z.number().min(0).max(100),
  elements: z.array(ElementSchema),
});

export const ArtboardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  source: SourceMetadataSchema.optional(),
  responsiveness: z.enum(["fixed", "dynamic"]).optional(),
  imageOnly: z.boolean().optional(),
  layers: z.array(LayerSchema),
});

export const FontMappingSchema = z.object({
  sourceFont: z.string().min(1),
  family: z.string().min(1),
  weight: z.string().optional(),
  style: z.string().optional(),
  vshift: z.string().optional(),
});

const CustomBlockSchema = z.object({
  type: z.enum(["css", "js", "html", "html-before", "html-after"]),
  content: z.string(),
});

export const AssetSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  hash: z.string().optional(),
  mimeType: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  artboardId: z.string().min(1),
  layerId: z.string().optional(),
  source: SourceMetadataSchema.optional(),
  exportParams: z.object({
    format: z.enum(["png", "png24", "jpg", "svg"]),
    scale: z.number().positive(),
    transparent: z.boolean().optional(),
    quality: z.number().optional(),
    colors: z.number().optional(),
  }),
});

export const SAFE_SETTING_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

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
      return z.number().positive().nullable();
  }
}

export const SettingsSchema = z
  .object(
    Object.fromEntries(
      SETTING_DEFINITIONS.map((definition) => [definition.key, settingSchemaFor(definition)]),
    ),
  )
  .partial();

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
    });

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
      }
    }
  });

export type DocumentInput = z.input<typeof DocumentSchema>;
