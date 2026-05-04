function sanitizeIdPart(value: string | undefined, fallback: string): string {
  const sanitized = (value || fallback).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

export function makeFigmaArtboardId(frame: {
  sourceNodeId?: string;
  originalName?: string;
  name?: string;
}): string {
  return `figma:${sanitizeIdPart(frame.sourceNodeId ?? frame.originalName ?? frame.name, "frame")}`;
}

export function makeFigmaLayerId(
  frame: { sourceNodeId?: string; originalName?: string; name?: string },
  layer: { sourceNodeId?: string; name?: string },
): string {
  return `${makeFigmaArtboardId(frame)}:layer:${sanitizeIdPart(layer.sourceNodeId ?? layer.name, "layer")}`;
}
