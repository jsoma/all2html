import { describe, expect, it } from "vitest";
import { createBrowserSvgRasterizer } from "../../src/importers/svg/rasterizer-browser.js";

describe("browser SVG rasterizer", () => {
  it("initializes the wasm module once and rasterizes through the browser adapter", async () => {
    const initCalls: unknown[] = [];
    const constructorCalls: Array<{ svg: string | Uint8Array; options: unknown }> = [];
    let renderedFreed = 0;
    let resvgFreed = 0;

    const fakeModule = {
      async initWasm(wasm: unknown) {
        initCalls.push(await wasm);
      },
      Resvg: class {
        constructor(svg: string | Uint8Array, options?: unknown) {
          constructorCalls.push({ svg, options });
        }

        render() {
          return {
            width: 3,
            height: 2,
            pixels: Uint8Array.from([
              255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 128,
              128, 128, 255,
            ]),
            free() {
              renderedFreed += 1;
            },
          };
        }

        free() {
          resvgFreed += 1;
        }
      },
    };

    const wasmInput = Promise.resolve(new Uint8Array([0, 97, 115, 109]).buffer);
    const first = await createBrowserSvgRasterizer({ wasm: wasmInput, module: fakeModule });
    const second = await createBrowserSvgRasterizer({ wasm: wasmInput, module: fakeModule });
    const result = await first.rasterizeSvg({
      svgContent: '<svg width="3" height="2"></svg>',
      scale: 2,
    });

    expect(initCalls).toHaveLength(1);
    expect(second).toBeDefined();
    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0].options).toEqual({
      fitTo: {
        mode: "zoom",
        value: 2,
      },
    });
    expect(result).toEqual({
      width: 3,
      height: 2,
      pixels: Uint8Array.from([
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 128, 128,
        128, 255,
      ]),
    });
    expect(renderedFreed).toBe(1);
    expect(resvgFreed).toBe(1);
  });

  it("retries wasm initialization after a failed attempt", async () => {
    const initWasm = async (_wasm: unknown) => {
      initCalls += 1;
      if (initCalls === 1) {
        throw new Error("first init failed");
      }
    };
    let initCalls = 0;

    const fakeModule = {
      initWasm,
      Resvg: class {
        render() {
          return {
            width: 1,
            height: 1,
            pixels: Uint8Array.from([255, 255, 255, 255]),
          };
        }
      },
    };

    await expect(
      createBrowserSvgRasterizer({
        wasm: Promise.resolve(new Uint8Array([0, 97, 115, 109]).buffer),
        module: fakeModule,
      }),
    ).rejects.toThrow("first init failed");

    const rasterizer = await createBrowserSvgRasterizer({
      wasm: Promise.resolve(new Uint8Array([0, 97, 115, 109]).buffer),
      module: fakeModule,
    });
    const result = await rasterizer.rasterizeSvg({
      svgContent: "<svg></svg>",
      scale: 1,
    });

    expect(initCalls).toBe(2);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
  });
});
