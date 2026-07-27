import type {
  ComputedPosition,
  ComputedShapePosition,
  DeduplicatedDocument,
  DeduplicatedTextElement,
  EmitterReadyArtboard,
  EmitterReadyDocument,
  EmitterReadyElement,
  EmitterReadyLayer,
  EmitterReadyShapeElement,
  EmitterReadySnippetElement,
  ShapeElement,
} from "../ir/types.js";

const CSS_PRECISION = 4;
const POINT_TEXT_EXTRA_WIDTH = 22;

function round(n: number, decimals: number = CSS_PRECISION): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];

/**
 * Index loop rather than `Array.prototype.every`: this transform ships inside the
 * ExtendScript (ES3) bundle, where `every` is neither native nor polyfilled
 * (`src/extendscript/polyfills.ts`). `test/integration/es5-runtime-apis.test.ts`
 * enforces that, so this must stay a loop unless a polyfill is added.
 */
function isIdentityMatrix(matrix: readonly number[]): boolean {
  if (matrix.length !== 6) return false;
  for (let i = 0; i < 6; i++) {
    if (matrix[i] !== IDENTITY_MATRIX[i]) return false;
  }
  return true;
}

function computeTextPosition(
  el: DeduplicatedTextElement,
  artboardWidth: number,
  artboardHeight: number,
  textResponsiveness: string,
): ComputedPosition {
  const pos = el.position;
  const result: ComputedPosition = { width: "" };

  // Width
  if (el.kind === "point") {
    result.width = `${pos.width + POINT_TEXT_EXTRA_WIDTH}px`;
  } else if (textResponsiveness === "dynamic") {
    result.width = `${round((pos.width / artboardWidth) * 100)}%`;
  } else {
    result.width = `${pos.width}px`;
  }

  // Horizontal positioning based on alignment
  const firstAlignment = el.paragraphs[0]?.alignment ?? "left";
  if (firstAlignment === "right") {
    const rightPct = round(((artboardWidth - pos.x - pos.width) / artboardWidth) * 100);
    result.right = `${rightPct}%`;
  } else if (firstAlignment === "center") {
    const centerX = pos.x + pos.width / 2;
    const leftPct = round((centerX / artboardWidth) * 100);
    result.left = `${leftPct}%`;
    if (el.kind === "point") {
      result.marginLeft = `-${round(pos.width / 2 + POINT_TEXT_EXTRA_WIDTH / 2)}px`;
    } else if (textResponsiveness === "dynamic") {
      result.marginLeft = `-${round((pos.width / artboardWidth / 2) * 100)}%`;
    } else {
      result.marginLeft = `-${round(pos.width / 2)}px`;
    }
  } else {
    const leftPct = round((pos.x / artboardWidth) * 100);
    result.left = `${leftPct}%`;
  }

  // Vertical positioning based on valign
  if (el.valign === "bottom") {
    const bottomPct = round(((artboardHeight - pos.y - pos.height) / artboardHeight) * 100);
    result.bottom = `${bottomPct}%`;
  } else if (el.valign === "middle") {
    const centerY = pos.y + pos.height / 2;
    const topPct = round((centerY / artboardHeight) * 100);
    result.top = `${topPct}%`;
    result.marginTop = `-${round(pos.height / 2)}px`;
  } else {
    const topPct = round((pos.y / artboardHeight) * 100);
    result.top = `${topPct}%`;
  }

  // Rotated text: apply CSS transform
  const vertAnchorPct = el.valign === "bottom" ? 100 : el.valign === "middle" ? 50 : 0;
  if (el.transformMatrix && el.rotation) {
    const m = el.transformMatrix;
    result.transform = `matrix(${m.map((v) => round(v, 6)).join(",")})`;
    result.transformOrigin = `50% ${vertAnchorPct}%`;
  } else if (el.transformMatrix && !isIdentityMatrix(el.transformMatrix)) {
    // Unrotated but scaled text (e.g. Illustrator's horizontal-scale slider).
    // Anchor the scale on the same edge the alignment anchors on, so the
    // element's computed left/right stays the visual anchor.
    //
    // The translation components (m[4]/m[5]) are dropped on purpose: this element's
    // placement is already fully expressed by the computed left/right/top/bottom
    // above, so passing them through would translate it a second time. Both current
    // producers emit zeros here (`plugins/illustrator/exporter.jsx` only sets
    // `transformMatrix` alongside `rotation`; `src/importers/svg/import-core.ts`
    // writes `[scale,0,0,1,0,0]`), so this changes no shipped output — it makes the
    // contract explicit for third-party IR that does carry a translation.
    //
    // The rotated branch above deliberately does NOT do this: it passes Illustrator's
    // matrix through whole, translation included, which is long-standing shipped
    // behavior pinned by the tracked goldens. The asymmetry is intentional, not an
    // oversight.
    const m = el.transformMatrix;
    const unrotated = [m[0], m[1], m[2], m[3], 0, 0];
    result.transform = `matrix(${unrotated.map((v) => round(v, 6)).join(",")})`;
    const horizAnchorPct = firstAlignment === "right" ? 100 : firstAlignment === "center" ? 50 : 0;
    result.transformOrigin = `${horizAnchorPct}% ${vertAnchorPct}%`;
  }

  return result;
}

function formatColor(c: { r: number; g: number; b: number }): string {
  return `rgb(${c.r},${c.g},${c.b})`;
}

export function computeShapePosition(
  el: ShapeElement,
  artboardWidth: number,
  artboardHeight: number,
  scaled: boolean,
): ComputedShapePosition {
  const pos = el.position;
  const centerX = pos.x + pos.width / 2;
  const centerY = pos.y + pos.height / 2;

  // Position is always percentage (center point as % of artboard)
  // Width/height/margins differ: scaled (%) vs fixed (px, rounded to int)
  const result: ComputedShapePosition = {
    left: `${round((centerX / artboardWidth) * 100)}%`,
    top: `${round((centerY / artboardHeight) * 100)}%`,
    marginLeft: scaled
      ? `-${round((pos.width / artboardWidth / 2) * 100)}%`
      : `-${Math.round(pos.width / 2)}px`,
    marginTop: scaled
      ? `-${round((pos.height / artboardHeight / 2) * 100)}%`
      : `-${Math.round(pos.height / 2)}px`,
    width: scaled ? `${round((pos.width / artboardWidth) * 100)}%` : `${Math.round(pos.width)}px`,
    height: scaled
      ? `${round((pos.height / artboardHeight) * 100)}%`
      : `${Math.round(pos.height)}px`,
  };

  if (el.shapeType === "circle") {
    result.borderRadius = "50%";
  }

  if (el.fill) {
    result.backgroundColor = formatColor(el.fill);
  }

  if (el.stroke) {
    const w = Math.max(1, Math.round(el.stroke.width));
    const stroke = `${w}px solid ${formatColor(el.stroke.color)}`;
    // Lines take a single edge instead of a full box. The edge is *chosen*, not
    // assigned and then cleared: writing `result.border = undefined` afterwards
    // left an enumerable `border` key holding `undefined`, which JSON.stringify
    // drops — so a document containing any line shape did not survive the round
    // trip the model is required to survive, and did so with every purity guard
    // green (they only looked for non-finite numbers).
    if (el.shapeType !== "line") {
      result.border = stroke;
    } else if (el.orientation === "vertical") {
      result.borderRight = stroke;
    } else {
      result.borderTop = stroke;
    }
  }

  if (el.opacity < 100) {
    result.opacity = String(round(el.opacity / 100, 2));
  }

  if (el.blendMode === "multiply") {
    result.mixBlendMode = "multiply";
  }

  return result;
}

export function computePositions(doc: DeduplicatedDocument): EmitterReadyDocument {
  const textResponsiveness = doc.settings.textResponsiveness;

  const artboards: EmitterReadyArtboard[] = doc.artboards.map((ab) => {
    const layers: EmitterReadyLayer[] = ab.layers.map((layer) => {
      const scaled = layer.type === "div";
      const elements: EmitterReadyElement[] = layer.elements.map((el) => {
        if (el.type === "text") {
          // Image-rendered text is a distinct variant and is never positioned.
          if (el.renderAs === "image") return el;
          const computedPosition = computeTextPosition(el, ab.width, ab.height, textResponsiveness);
          return { ...el, computedPosition };
        }
        if (el.type === "shape") {
          const computedShapePosition = computeShapePosition(el, ab.width, ab.height, scaled);
          const shaped: EmitterReadyShapeElement = { ...el, computedShapePosition };
          return shaped;
        }
        if (el.type === "snippet") {
          const pos = el.position;
          const computedPosition: ComputedPosition = {
            top: `${round((pos.y / ab.height) * 100)}%`,
            left: `${round((pos.x / ab.width) * 100)}%`,
            width: `${round((pos.width / ab.width) * 100)}%`,
          };
          const snippet: EmitterReadySnippetElement = { ...el, computedPosition };
          return snippet;
        }
        return el;
      });
      return { ...layer, elements };
    });
    return { ...ab, layers };
  });

  return { ...doc, pipelinePhase: "emitterReady", artboards };
}
