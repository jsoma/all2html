import type {
  ComputedPosition,
  EmitterReadyDocument,
  EmitterReadyElement,
} from "../../ir/types.js";

const CSS_PRECISION = 4;

function round(n: number, decimals: number = CSS_PRECISION): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/**
 * Parse a CSS value like "123px" or "45.6789%" and return the numeric part.
 * Returns null if the value doesn't match the expected unit.
 *
 * The bare `parseFloat` is deliberate: this module ships inside the ExtendScript
 * (ES3) bundle, where the `Number` namespace forms added in ES2015 do not exist
 * and `polyfills.ts` does not install them. `Number.parseFloat` — one
 * `style/useNumberNamespace` autofix away — threw here for as long as it took the
 * source-level scan in `test/integration/es5-runtime-apis.test.ts` to find it;
 * rollup tree-shakes this module out of the bundle unless `positionMode:
 * "percentage"` is set, so the artifact scan saw nothing. `Number.isNaN` below is
 * fine: `polyfills.ts` installs it.
 */
function parseCssValue(value: string, unit: string): number | null {
  if (!value.endsWith(unit)) return null;
  const num = parseFloat(value.slice(0, -unit.length));
  return Number.isNaN(num) ? null : num;
}

/**
 * Convert pixel margin values to percentage-based positioning with CSS transform.
 * In percentage mode:
 * - Center-aligned text: uses transform: translateX(-50%) instead of pixel marginLeft
 * - Middle-valigned text: uses transform: translateY(-50%) instead of pixel marginTop
 * - Point text width: converted from px to percentage of artboard width
 * - Area text in fixed mode: width stays as percentage (already handled by dynamic mode)
 */
function convertPosition(pos: ComputedPosition, artboardWidth: number): ComputedPosition {
  const result = { ...pos };
  const transforms: string[] = [];

  // Convert marginLeft (px or %) to translateX(-50%) for center-aligned text.
  // Both pixel and percentage margins in the pipeline are used exclusively
  // for center anchoring, so -50% of element width is always correct.
  if (result.marginLeft) {
    const px = parseCssValue(result.marginLeft, "px");
    const pct = parseCssValue(result.marginLeft, "%");
    if (px !== null || pct !== null) {
      transforms.push("translateX(-50%)");
      result.marginLeft = undefined;
    }
  }

  // Convert pixel marginTop to translateY(-50%) for middle-valigned text
  if (result.marginTop) {
    const px = parseCssValue(result.marginTop, "px");
    if (px !== null) {
      transforms.push("translateY(-50%)");
      result.marginTop = undefined;
    }
  }

  // Convert any pixel width to percentage of artboard width
  const widthPx = parseCssValue(result.width, "px");
  if (widthPx !== null) {
    result.width = `${round((widthPx / artboardWidth) * 100)}%`;
  }

  // Merge transforms: prepend translations before rotation matrix so
  // they apply in the element's local coordinate space
  if (transforms.length > 0) {
    if (result.transform) {
      result.transform = `${transforms.join(" ")} ${result.transform}`;
    } else {
      result.transform = transforms.join(" ");
    }
  }

  return result;
}

/**
 * Convert an EmitterReadyDocument from absolute positioning (pixel margins)
 * to percentage positioning (CSS transform anchoring).
 *
 * This is an emitter-side post-transform — the core pipeline always computes
 * positions in the standard way, and this converts the remaining pixel values
 * to percentages when positionMode === 'percentage'.
 */
export function convertToPercentageMode(doc: EmitterReadyDocument): EmitterReadyDocument {
  const artboards = doc.artboards.map((ab) => {
    const layers = ab.layers.map((layer) => {
      const elements: EmitterReadyElement[] = layer.elements.map((el) => {
        if (el.type === "text" && el.renderAs === "html") {
          const converted = convertPosition(el.computedPosition, ab.width);
          return { ...el, computedPosition: converted };
        }
        return el;
      });
      return { ...layer, elements };
    });
    return { ...ab, layers };
  });
  return { ...doc, artboards };
}
