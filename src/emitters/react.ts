import type { EmitterReadyDocument } from "../ir/types.js";
import { type EmitGroupOptions, emitHTML } from "./html.js";
import type { ReactEmitterOptions } from "./types.js";

export interface EmitReactResult {
  jsx: string;
  warnings: string[];
}

const ASSETS_TOKEN = "__ALL2HTML_ASSETS__";

export function emitReact(
  doc: EmitterReadyDocument,
  groupOptions?: EmitGroupOptions,
  options?: ReactEmitterOptions,
): EmitReactResult {
  const slug = groupOptions?.slug || doc.settings.projectName || doc.metadata.slug;

  // Override imageSourcePath so the HTML emitter places our token natively
  // in both src="..." and url(...) contexts (CSS custom property images).
  const tokenizedDoc: EmitterReadyDocument = {
    ...doc,
    settings: { ...doc.settings, imageSourcePath: `${ASSETS_TOKEN}/` },
  };
  const { html: fragment, warnings } = emitHTML(tokenizedDoc, groupOptions, options);

  // Extract <style> block
  const styleMatch = fragment.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  const css = styleMatch ? styleMatch[1] : "";
  const htmlWithoutStyle = fragment.replace(/<style[^>]*>[\s\S]*?<\/style>\s*/, "");

  // Remove HTML comments
  const tokenizedHtml = htmlWithoutStyle.replace(/<!--[\s\S]*?-->/g, "").trim();

  // Generate component name from slug (must be valid JS identifier)
  let componentName = slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  // Prefix if starts with a number (e.g. "2024ElectionMap" → "Graphic2024ElectionMap")
  if (/^\d/.test(componentName)) componentName = "Graphic" + componentName;

  const escapedCSS = escapeTemplateLiteral(css);
  const escapedHTML = escapeTemplateLiteral(tokenizedHtml);
  const isTypeScript = options?.typescript === true;

  let jsx: string;
  if (isTypeScript) {
    jsx = `import type { JSX } from "react";
import { useMemo } from "react";

interface ${componentName}Props {
  assetsPath?: string;
  className?: string;
}

const ASSET_TOKEN = "${ASSETS_TOKEN}";
const cssText = \`${escapedCSS}\`;
const htmlTemplate = \`${escapedHTML}\`;

export default function ${componentName}({ assetsPath = ".", className = "" }: ${componentName}Props): JSX.Element {
  const safePath = assetsPath.replace(/\\/+$/, "");
  const html = useMemo(
    () => htmlTemplate.split(ASSET_TOKEN).join(safePath),
    [safePath]
  );

  return (
    <div className={className}>
      <style dangerouslySetInnerHTML={{ __html: cssText }} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
`;
  } else {
    jsx = `import React, { useMemo } from "react";

const ASSET_TOKEN = "${ASSETS_TOKEN}";
const cssText = \`${escapedCSS}\`;
const htmlTemplate = \`${escapedHTML}\`;

export default function ${componentName}({ assetsPath = ".", className = "" }) {
  const safePath = assetsPath.replace(/\\/+$/, "");
  const html = useMemo(
    () => htmlTemplate.split(ASSET_TOKEN).join(safePath),
    [safePath]
  );

  return (
    <div className={className}>
      <style dangerouslySetInnerHTML={{ __html: cssText }} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
`;
  }

  return { jsx, warnings };
}

function escapeTemplateLiteral(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}
