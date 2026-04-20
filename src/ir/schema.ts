import { z } from "zod";

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
  name: z.string(),
  type: z.enum(["default", "svg", "png", "symbol", "div", "video", "html-before", "html-after"]),
  inlineSvg: z.boolean(),
  visible: z.boolean(),
  opacity: z.number().min(0).max(100),
  elements: z.array(ElementSchema),
});

export const ArtboardSchema = z.object({
  name: z.string().min(1),
  originalName: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  actualWidth: z.number().positive(),
  actualHeight: z.number().positive(),
  responsiveness: z.enum(["fixed", "dynamic"]).optional(),
  imageOnly: z.boolean().optional(),
  layers: z.array(LayerSchema),
});

export const FontMappingSchema = z.object({
  aifont: z.string().min(1),
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
  artboardName: z.string().min(1),
  layerName: z.string().optional(),
  exportParams: z.object({
    format: z.enum(["png", "png24", "jpg", "svg"]),
    scale: z.number().positive(),
    transparent: z.boolean().optional(),
    quality: z.number().optional(),
    colors: z.number().optional(),
  }),
});

const ImageFormatSchema = z.enum(["auto", "png", "png24", "jpg", "svg"]);

export const SettingsSchema = z
  .object({
    imageFormat: z.array(ImageFormatSchema),
    writeImageFiles: z.boolean(),
    pngTransparent: z.boolean(),
    pngNumberOfColors: z.number().int().min(1).max(256),
    jpgQuality: z.number().int().min(0).max(100),
    use2xImages: z.boolean(),
    cacheBustToken: z.number().int().positive().nullable(),
    namespace: z.string(),
    projectName: z.string(),
    output: z.enum(["one-file", "multiple-files"]),
    htmlOutputPath: z.string(),
    htmlOutputExtension: z.string(),
    imageOutputPath: z.string(),
    imageSourcePath: z.string(),
    responsiveness: z.enum(["fixed", "dynamic"]),
    textResponsiveness: z.enum(["fixed", "dynamic"]),
    maxWidth: z.number().positive().nullable(),
    centerHtmlOutput: z.boolean(),
    renderTextAs: z.enum(["html", "image"]),
    renderRotatedSkewedTextAs: z.enum(["html", "image"]),
    testingMode: z.boolean(),
    includeResizerCss: z.boolean(),
    includeResizerWidths: z.boolean(),
    responsiveImageMode: z.enum(["img-src", "css-var"]),
    useLazyLoader: z.boolean(),
    inlineSvg: z.boolean(),
    svgIdPrefix: z.string(),
    svgEmbedImages: z.boolean(),
    clickableLink: z.string(),
    createPromoImage: z.boolean(),
    promoImageWidth: z.number().int().positive(),
    localPreviewTemplate: z.string(),
  })
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

export const DocumentSchema = z.object({
  irVersion: z.string().min(1),
  generator: z.object({
    tool: z.string().min(1),
    toolVersion: z.string(),
    pluginVersion: z.string(),
  }),
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
});

export type DocumentInput = z.input<typeof DocumentSchema>;
