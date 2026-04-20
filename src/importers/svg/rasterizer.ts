import jpeg from "jpeg-js";
import UPNG from "upng-js";
import type { Settings } from "../../ir/types.js";

export interface SvgRasterizeRequest {
  svgContent: string;
  scale: number;
}

export interface RasterizedImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface SvgRasterizer {
  rasterizeSvg(request: SvgRasterizeRequest): Promise<RasterizedImage>;
}

export function encodeRasterImage(
  image: RasterizedImage,
  format: "png" | "png24" | "jpg",
  settings: Settings,
): { bytes: Uint8Array; mimeType: string; width: number; height: number } {
  const rgba = shouldFlatten(format, settings.pngTransparent)
    ? flattenRgbaOntoWhite(image.pixels)
    : image.pixels;

  if (format === "jpg") {
    const encoded = jpeg.encode(
      {
        data: rgba,
        width: image.width,
        height: image.height,
      },
      settings.jpgQuality || 85,
    );
    return {
      bytes: Uint8Array.from(encoded.data),
      mimeType: "image/jpeg",
      width: image.width,
      height: image.height,
    };
  }

  const colorCount = format === "png" ? settings.pngNumberOfColors || 128 : 0;
  const encoded = UPNG.encode([toArrayBuffer(rgba)], image.width, image.height, colorCount);
  return {
    bytes: new Uint8Array(encoded),
    mimeType: "image/png",
    width: image.width,
    height: image.height,
  };
}

function shouldFlatten(
  format: "png" | "png24" | "jpg",
  pngTransparent: boolean | undefined,
): boolean {
  return format === "jpg" || !pngTransparent;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBufferLike {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  return bytes.slice().buffer;
}

function flattenRgbaOntoWhite(pixels: Uint8Array): Uint8Array {
  const flattened = new Uint8Array(pixels.length);
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    const inverseAlpha = 1 - alpha;
    flattened[index] = Math.round(pixels[index] * alpha + 255 * inverseAlpha);
    flattened[index + 1] = Math.round(pixels[index + 1] * alpha + 255 * inverseAlpha);
    flattened[index + 2] = Math.round(pixels[index + 2] * alpha + 255 * inverseAlpha);
    flattened[index + 3] = 255;
  }
  return flattened;
}
