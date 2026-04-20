import type { InitInput, ResvgRenderOptions } from "@resvg/resvg-wasm";
import type { RasterizedImage, SvgRasterizeRequest, SvgRasterizer } from "./rasterizer.js";

interface BrowserRenderedImage {
  width: number;
  height: number;
  pixels: Uint8Array;
  free?: () => void;
}

interface BrowserResvgInstance {
  render(): BrowserRenderedImage;
  free?: () => void;
}

export interface BrowserResvgModule {
  initWasm(moduleOrPath: Promise<InitInput> | InitInput): Promise<void>;
  Resvg: new (svg: Uint8Array | string, options?: ResvgRenderOptions) => BrowserResvgInstance;
}

export interface BrowserSvgRasterizerOptions {
  wasm: Promise<InitInput> | InitInput;
  module?: BrowserResvgModule;
}

const initializedModules = new WeakMap<object, Promise<void>>();

export async function createBrowserSvgRasterizer(
  options: BrowserSvgRasterizerOptions,
): Promise<SvgRasterizer> {
  const resvgModule = options.module ?? (await import("@resvg/resvg-wasm"));
  await ensureBrowserModuleInitialized(resvgModule, options.wasm);

  return {
    async rasterizeSvg(request: SvgRasterizeRequest): Promise<RasterizedImage> {
      const renderOptions =
        request.scale === 1
          ? undefined
          : ({
              fitTo: {
                mode: "zoom",
                value: request.scale,
              },
            } satisfies ResvgRenderOptions);
      const resvg = new resvgModule.Resvg(request.svgContent, renderOptions);
      try {
        const rendered = resvg.render();
        try {
          return {
            width: rendered.width,
            height: rendered.height,
            pixels: Uint8Array.from(rendered.pixels),
          };
        } finally {
          rendered.free?.();
        }
      } finally {
        resvg.free?.();
      }
    },
  };
}

async function ensureBrowserModuleInitialized(
  resvgModule: BrowserResvgModule,
  wasm: Promise<InitInput> | InitInput,
): Promise<void> {
  let initialization = initializedModules.get(resvgModule);
  if (!initialization) {
    initialization = resvgModule.initWasm(wasm).catch((error) => {
      initializedModules.delete(resvgModule);
      throw error;
    });
    initializedModules.set(resvgModule, initialization);
  }
  await initialization;
}
