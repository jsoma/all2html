import { describe, expect, it } from "vitest";
import { encodeRasterImage } from "../../src/importers/svg/rasterizer.js";
import { defaultSettings } from "../../src/ir/defaults.js";
import type { Settings } from "../../src/ir/types.js";

/**
 * `jpgQuality: 0` is a declared-valid value (settings-definitions min 0) and
 * must not be erased to the default by a `||` fallback (spec §2.1).
 */

function solidImage(width: number, height: number) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    // A gradient-ish fill so JPEG quality actually changes the encoded bytes.
    pixels[i] = (i / 4) % 256;
    pixels[i + 1] = 128;
    pixels[i + 2] = 255 - ((i / 4) % 256);
    pixels[i + 3] = 255;
  }
  return { width, height, pixels };
}

function settingsWith(jpgQuality?: number): Settings {
  const settings: Settings = { ...defaultSettings };
  if (jpgQuality === undefined) {
    delete (settings as Partial<Settings>).jpgQuality;
  } else {
    settings.jpgQuality = jpgQuality;
  }
  return settings;
}

describe("encodeRasterImage honors jpgQuality: 0", () => {
  it("encodes quality 0 differently from the default", () => {
    const image = solidImage(32, 32);
    const zero = encodeRasterImage(image, "jpg", settingsWith(0));
    const dflt = encodeRasterImage(image, "jpg", settingsWith());
    const high = encodeRasterImage(image, "jpg", settingsWith(100));

    // With the old `|| 85`, quality 0 silently became the default and these
    // bytes were identical.
    expect(Buffer.from(zero.bytes).equals(Buffer.from(dflt.bytes))).toBe(false);
    // Sanity: quality is monotone enough that 0 is smaller than 100.
    expect(zero.bytes.byteLength).toBeLessThan(high.bytes.byteLength);
    expect(zero.mimeType).toBe("image/jpeg");
  });
});
