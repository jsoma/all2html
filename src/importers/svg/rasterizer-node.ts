import { Resvg } from "@resvg/resvg-js";
import type { RasterizedImage, SvgRasterizeRequest, SvgRasterizer } from "./rasterizer.js";

export function createNodeSvgRasterizer(): SvgRasterizer {
  return {
    async rasterizeSvg(request: SvgRasterizeRequest): Promise<RasterizedImage> {
      const resvg = new Resvg(
        request.svgContent,
        request.scale === 1
          ? undefined
          : {
              fitTo: {
                mode: "zoom",
                value: request.scale,
              },
            },
      );
      const rendered = resvg.render();
      return {
        width: rendered.width,
        height: rendered.height,
        pixels: Uint8Array.from(rendered.pixels),
      };
    },
  };
}
