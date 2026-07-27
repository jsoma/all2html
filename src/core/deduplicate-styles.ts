import type {
  ComputedTextStyle,
  DeduplicatedArtboard,
  DeduplicatedDocument,
  DeduplicatedElement,
  DeduplicatedLayer,
  DeduplicatedTextElement,
  EffectStyleEntry,
  StyleClassEntry,
  StyledDocument,
  StyledElement,
  StyledTextElement,
  TextEffect,
} from "../ir/types.js";

function getStyleKey(style: ComputedTextStyle): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}~${v}`)
    .join("|");
}

function styleDiff(base: ComputedTextStyle, variant: ComputedTextStyle): ComputedTextStyle | null {
  const diff: ComputedTextStyle = {};
  let hasDiff = false;
  for (const [key, value] of Object.entries(variant)) {
    if (value !== undefined && value !== base[key]) {
      diff[key] = value;
      hasDiff = true;
    }
  }
  return hasDiff ? diff : null;
}

/** Pure discriminant test — both tags are declared literals on the element union,
 *  so nothing has to sniff for the presence of a computed field. */
function isStyledText(el: StyledElement): el is StyledTextElement {
  return el.type === "text" && el.renderAs === "html";
}

function formatColor(c: { r: number; g: number; b: number; opacity?: number }): string {
  const opacity = c.opacity ?? 100;
  if (opacity < 100) {
    return `rgba(${c.r},${c.g},${c.b},${(opacity / 100).toFixed(2)})`;
  }
  return `rgb(${c.r},${c.g},${c.b})`;
}

function effectsToCSS(effects: TextEffect[]): string {
  const parts: string[] = [];

  // Drop shadows → text-shadow (multiple comma-separated)
  const shadows = effects.filter((e) => e.type === "dropShadow");
  if (shadows.length > 0) {
    const shadowValues = shadows.map(
      (s) => `${s.offsetX}px ${s.offsetY}px ${s.blurRadius}px ${formatColor(s.color)}`,
    );
    parts.push(`text-shadow: ${shadowValues.join(", ")};`);
  }

  // Blur → filter (only first)
  const blur = effects.find((e) => e.type === "blur");
  if (blur) {
    parts.push(`filter: blur(${blur.radius}px);`);
  }

  return parts.join(" ");
}

function getEffectKey(effects: TextEffect[]): string {
  return effects
    .map((e) => {
      if (e.type === "dropShadow") {
        return `ds:${e.offsetX},${e.offsetY},${e.blurRadius},${e.color.r},${e.color.g},${e.color.b},${e.color.opacity ?? 100}`;
      }
      return `blur:${e.radius}`;
    })
    .sort()
    .join("|");
}

export function deduplicateStyles(doc: StyledDocument): DeduplicatedDocument {
  const ns = doc.settings.namespace;

  const artboards: DeduplicatedArtboard[] = doc.artboards.map((ab) => {
    // Collect all paragraph styles with character counts — plain object, not Map
    const styleCounts: Record<string, { style: ComputedTextStyle; count: number }> = {};

    for (const layer of ab.layers) {
      for (const el of layer.elements) {
        if (!isStyledText(el)) continue;
        for (let i = 0; i < el.computedParagraphStyles.length; i++) {
          const style = el.computedParagraphStyles[i];
          const key = getStyleKey(style);
          const para = el.paragraphs[i];
          const charCount = para.text.length;
          if (key in styleCounts) {
            styleCounts[key].count += charCount;
          } else {
            styleCounts[key] = { style, count: charCount };
          }
        }
      }
    }

    // Find base style (most common by character count)
    let baseParagraphStyle: ComputedTextStyle = {
      fontFamily: "arial,helvetica,sans-serif",
      fontSize: "14px",
      fontWeight: "normal",
      fontStyle: "normal",
      color: "rgb(0,0,0)",
      lineHeight: "18px",
    };
    let maxCount = 0;
    for (const key of Object.keys(styleCounts)) {
      const { style, count } = styleCounts[key];
      if (count > maxCount) {
        maxCount = count;
        baseParagraphStyle = style;
      }
    }

    // Assign paragraph style classes — sorted deterministically
    const sortedStyles = Object.entries(styleCounts).sort(
      ([keyA, a], [keyB, b]) => b.count - a.count || keyA.localeCompare(keyB),
    );

    const paragraphStyleClasses: StyleClassEntry[] = [];
    let pstyleIndex = 0;
    for (const [key, { style }] of sortedStyles) {
      const diff = styleDiff(baseParagraphStyle, style);
      if (diff) {
        paragraphStyleClasses.push({
          key,
          className: `${ns}pstyle${pstyleIndex}`,
          style: diff,
        });
        pstyleIndex++;
      }
    }

    // Build paragraph class lookup — plain object
    const paraClassByKey: Record<string, string> = {};
    for (const entry of paragraphStyleClasses) {
      paraClassByKey[entry.key] = entry.className;
    }

    // Collect character style diffs — plain object
    const charStyleDiffs: Record<string, ComputedTextStyle> = {};
    for (const layer of ab.layers) {
      for (const el of layer.elements) {
        if (!isStyledText(el)) continue;
        for (let pi = 0; pi < el.computedRunStyles.length; pi++) {
          const paraStyle = el.computedParagraphStyles[pi];
          for (const runStyle of el.computedRunStyles[pi]) {
            const diff = styleDiff(paraStyle, runStyle);
            if (diff) {
              const key = getStyleKey(diff);
              if (!(key in charStyleDiffs)) {
                charStyleDiffs[key] = diff;
              }
            }
          }
        }
      }
    }

    // Sort character style keys deterministically and assign indices
    const sortedCharKeys = Object.entries(charStyleDiffs).sort(([a], [b]) => a.localeCompare(b));
    const characterStyleClasses: StyleClassEntry[] = [];
    let cstyleIndex = 0;
    for (const [key, style] of sortedCharKeys) {
      characterStyleClasses.push({
        key,
        className: `${ns}cstyle${cstyleIndex}`,
        style,
      });
      cstyleIndex++;
    }

    const charClassByKey: Record<string, string> = {};
    for (const entry of characterStyleClasses) {
      charClassByKey[entry.key] = entry.className;
    }

    // Collect and deduplicate effect styles
    const effectKeys: Record<string, { effects: TextEffect[]; css: string }> = {};
    for (const layer of ab.layers) {
      for (const el of layer.elements) {
        if (!isStyledText(el)) continue;
        if (el.effects && el.effects.length > 0) {
          const key = getEffectKey(el.effects);
          if (!(key in effectKeys)) {
            effectKeys[key] = { effects: el.effects, css: effectsToCSS(el.effects) };
          }
        }
      }
    }

    const sortedEffectKeys = Object.keys(effectKeys).sort();
    const effectStyleClasses: EffectStyleEntry[] = [];
    let effectIndex = 0;
    for (const key of sortedEffectKeys) {
      effectStyleClasses.push({
        key,
        className: `${ns}effect${effectIndex}`,
        css: effectKeys[key].css,
      });
      effectIndex++;
    }

    const effectClassByKey: Record<string, string> = {};
    for (const entry of effectStyleClasses) {
      effectClassByKey[entry.key] = entry.className;
    }

    // Assign class names to elements
    const layers: DeduplicatedLayer[] = ab.layers.map((layer) => {
      const elements: DeduplicatedElement[] = layer.elements.map((el) => {
        if (!isStyledText(el)) return el;

        const paragraphClassNames: (string | null)[] = [];
        const runClassNames: (string | null)[][] = [];

        for (let pi = 0; pi < el.computedParagraphStyles.length; pi++) {
          const paraStyle = el.computedParagraphStyles[pi];
          const paraKey = getStyleKey(paraStyle);
          paragraphClassNames.push(paraClassByKey[paraKey] ?? null);

          const runCls: (string | null)[] = [];
          for (const runStyle of el.computedRunStyles[pi]) {
            const diff = styleDiff(paraStyle, runStyle);
            if (diff) {
              const key = getStyleKey(diff);
              runCls.push(charClassByKey[key] ?? null);
            } else {
              runCls.push(null);
            }
          }
          runClassNames.push(runCls);
        }

        // Look up effect class
        let effectClassName: string | null = null;
        if (el.effects && el.effects.length > 0) {
          const key = getEffectKey(el.effects);
          effectClassName = effectClassByKey[key] ?? null;
        }

        // No `computedPosition` placeholder: positions are `computePositions`' output,
        // one phase later, and the `deduplicated` phase type no longer demands them.
        const enriched: DeduplicatedTextElement = {
          ...el,
          paragraphClassNames,
          runClassNames,
          effectClassName,
        };
        return enriched;
      });
      return { ...layer, elements };
    });

    return {
      ...ab,
      baseParagraphStyle,
      paragraphStyleClasses,
      characterStyleClasses,
      effectStyleClasses,
      layers,
    };
  });

  return { ...doc, pipelinePhase: "deduplicated", artboards };
}
