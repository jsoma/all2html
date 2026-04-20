/**
 * SVG post-processing module.
 * Cleans up Illustrator-generated SVG:
 * - Replaces auto-generated IDs with meaningful names
 * - Adds data-name attributes
 * - Handles duplicate IDs
 * - Injects non-scaling-stroke CSS
 * - Removes embedded raster images
 * - Restores opacity/multiply from encoded names
 */

const SHAPE_ELEMENTS = ["rect", "circle", "path", "line", "polyline", "polygon", "ellipse"];

let emptyIdCounter = 0;

/**
 * Decode Illustrator hex character codes in IDs.
 * Supports both 2-digit ASCII (_x41_) and 4-digit Unicode (_x2014_) formats.
 */
function decodeHexCodes(str: string): string {
  return str.replace(/_x([0-9A-Fa-f]{2,4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Escape characters that are invalid in XML attribute values.
 */
function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Clean an Illustrator-generated ID into a meaningful name.
 * Strips numeric suffixes like "_1_", decodes hex chars.
 */
function cleanId(id: string): string {
  let cleaned = id;
  // Remove trailing underscores and numeric suffixes (e.g., "Layer_1_" → "Layer")
  cleaned = cleaned.replace(/_\d+_?$/, "");
  // Decode hex character codes
  cleaned = decodeHexCodes(cleaned);
  // Replace remaining underscores with hyphens for CSS compatibility
  cleaned = cleaned.replace(/_/g, "-");
  // Remove leading/trailing hyphens
  cleaned = cleaned.replace(/^-+|-+$/g, "");
  // Fallback for empty IDs
  if (!cleaned) {
    cleaned = "item-" + ++emptyIdCounter;
  }
  return cleaned;
}

/**
 * Parse opacity/multiply workaround from element names.
 * ai2html encodes these as: "Z--opacity50--originalname" or "Z--multiply--originalname"
 */
interface EncodedEffects {
  opacity?: number;
  multiply?: boolean;
  originalName?: string;
}

function parseEncodedEffects(name: string): EncodedEffects | null {
  if (!name.startsWith("Z--")) return null;
  const effects: EncodedEffects = {};
  const parts = name.substring(3).split("--");
  for (const part of parts) {
    if (part.startsWith("opacity")) {
      effects.opacity = parseInt(part.substring(7), 10) / 100;
    } else if (part === "multiply") {
      effects.multiply = true;
    } else {
      effects.originalName = part;
    }
  }
  return effects;
}

/**
 * Process an SVG string from Illustrator export.
 */
export function postprocessSVG(
  svgContent: string,
  options: {
    idPrefix?: string;
    injectNonScalingStroke?: boolean;
    stripRasterImages?: boolean;
  } = {},
): string {
  let svg = svgContent;
  const prefix = options.idPrefix || "";
  const usedIds = new Set<string>();
  emptyIdCounter = 0;

  // Remove <?xml ?> processing instruction
  svg = svg.replace(/<\?xml[^?]*\?>\s*/, "");

  // STEP 1: Restore opacity/multiply from encoded names BEFORE ID cleanup.
  // Track encoded → restored mappings so STEP 3 can update cross-references.
  const encodedIdMap = new Map<string, string>();

  svg = svg.replace(/\bid="(Z--[^"]+)"/g, (match, encodedId: string) => {
    const effects = parseEncodedEffects(encodedId);
    if (!effects) return match;
    const styles: string[] = [];
    if (effects.opacity !== undefined) {
      styles.push(`opacity:${effects.opacity}`);
    }
    if (effects.multiply) {
      styles.push("mix-blend-mode:multiply");
    }
    const styleAttr = styles.length > 0 ? ` style="${styles.join(";")}"` : "";
    const restoredName = effects.originalName || "";
    if (restoredName) {
      encodedIdMap.set(encodedId, restoredName);
    }
    const restoredId = restoredName ? `id="${escapeXmlAttr(restoredName)}"` : "";
    return `${restoredId}${styleAttr}`.trim();
  });

  // STEP 2: Clean IDs and add data-name attributes
  const idMap = new Map<string, string>();

  svg = svg.replace(/\bid="([^"]+)"/g, (match, originalId: string) => {
    const cleaned = cleanId(originalId);
    let finalId = prefix + cleaned;

    // Handle duplicates
    if (usedIds.has(finalId)) {
      let counter = 2;
      while (usedIds.has(`${finalId}-${counter}`)) counter++;
      finalId = `${finalId}-${counter}`;
    }
    usedIds.add(finalId);
    idMap.set(originalId, finalId);

    return `id="${escapeXmlAttr(finalId)}" data-name="${escapeXmlAttr(cleaned)}"`;
  });

  // Add encoded ID → final ID mappings (Z--opacity50--name → cleaned name)
  // so cross-references like url(#Z--opacity50--name) get updated
  encodedIdMap.forEach((restoredName, encodedId) => {
    const finalId = idMap.get(restoredName);
    if (finalId) {
      idMap.set(encodedId, finalId);
    }
  });

  // STEP 3: Update references to renamed IDs (all common SVG reference forms)
  // Sort by descending old ID length to prevent substring collisions
  const sortedEntries: Array<[string, string]> = [];
  idMap.forEach((newId, oldId) => {
    sortedEntries.push([oldId, newId]);
  });
  sortedEntries.sort(([a], [b]) => b.length - a.length);
  for (const [oldId, newId] of sortedEntries) {
    svg = svg.split(`url(#${oldId})`).join(`url(#${newId})`);
    svg = svg.split(`url('#${oldId}')`).join(`url('#${newId}')`);
    svg = svg.split(`url("#${oldId}")`).join(`url("#${newId}")`);
    svg = svg.split(`xlink:href="#${oldId}"`).join(`xlink:href="#${newId}"`);
    svg = svg.split(`href="#${oldId}"`).join(`href="#${newId}"`);
  }

  // Remove embedded <image> elements (raster content in SVG)
  if (options.stripRasterImages !== false) {
    svg = svg.replace(/<image[^>]*\/>/g, "");
    svg = svg.replace(/<image[^>]*>[\s\S]*?<\/image>/g, "");
  }

  // Inject non-scaling-stroke CSS (case-insensitive, whitespace-tolerant)
  if (options.injectNonScalingStroke !== false) {
    const shapeSelector = SHAPE_ELEMENTS.join(",");
    const css = `${shapeSelector}{vector-effect:non-scaling-stroke}`;
    svg = svg.replace(/<\/svg\s*>/i, `<style>${css}</style></svg>`);
  }

  return svg;
}
