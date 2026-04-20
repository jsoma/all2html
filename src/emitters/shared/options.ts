import type { EmitterReadyDocument } from "../../ir/types.js";
import { convertToPercentageMode } from "./percentage-positions.js";

interface CommonEmitterOptions {
  positionMode?: "percentage" | "absolute";
  allowUnsafeHtml?: boolean;
  responsiveImageMode?: "img-src" | "css-var";
}

function suppressUnsafeBindingHtml(doc: EmitterReadyDocument): EmitterReadyDocument {
  const artboards = doc.artboards.map((ab) => ({
    ...ab,
    layers: ab.layers.map((layer) => ({
      ...layer,
      elements: layer.elements.map((el) => {
        if (el.type === "text" && el.binding?.allowHtml) {
          return {
            ...el,
            binding: {
              ...el.binding,
              allowHtml: false,
            },
          };
        }
        return el;
      }),
    })),
  }));

  return { ...doc, artboards };
}

export function applyEmitterOptions(
  doc: EmitterReadyDocument,
  options?: CommonEmitterOptions,
): EmitterReadyDocument {
  let resolved = doc;

  if (options?.positionMode === "percentage") {
    resolved = convertToPercentageMode(resolved);
  }

  if (options?.allowUnsafeHtml === false) {
    resolved = suppressUnsafeBindingHtml(resolved);
  }

  return resolved;
}
