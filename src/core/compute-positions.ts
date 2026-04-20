import type {
  ComputedPosition,
  ComputedShapePosition,
  EmitterReadyDocument,
  EmitterReadyShapeElement,
  EmitterReadySnippetElement,
  EmitterReadyTextElement,
  ShapeElement,
} from "../ir/types.js";
import type { DeduplicatedDocument } from "./deduplicate-styles.js";

const CSS_PRECISION = 4;
const POINT_TEXT_EXTRA_WIDTH = 22;

function round(n: number, decimals: number = CSS_PRECISION): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function isEmitterReadyText(el: { type: string }): el is EmitterReadyTextElement {
  return el.type === "text" && "computedParagraphStyles" in el;
}

function computeTextPosition(
  el: EmitterReadyTextElement,
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
  if (el.transformMatrix && el.rotation) {
    const m = el.transformMatrix;
    result.transform = `matrix(${m.map((v) => round(v, 6)).join(",")})`;
    const vertAnchorPct = el.valign === "bottom" ? 100 : el.valign === "middle" ? 50 : 0;
    result.transformOrigin = `50% ${vertAnchorPct}%`;
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
    result.border = `${w}px solid ${formatColor(el.stroke.color)}`;
    // Lines use border-top or border-right instead
    if (el.shapeType === "line") {
      if (el.orientation === "vertical") {
        result.border = undefined;
        result.borderRight = `${w}px solid ${formatColor(el.stroke.color)}`;
      } else {
        result.border = undefined;
        result.borderTop = `${w}px solid ${formatColor(el.stroke.color)}`;
      }
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

  const artboards = doc.artboards.map((ab) => {
    const layers = ab.layers.map((layer) => {
      const scaled = layer.type === "div";
      const elements = layer.elements.map((el) => {
        if (isEmitterReadyText(el) && el.renderAs !== "image") {
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

  return { ...doc, artboards };
}
