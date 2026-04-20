import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FontEntry } from "../../plugins/illustrator/panel/src/shared/types.js";

vi.mock("../../plugins/illustrator/panel/src/js/lib/utils/bolt.js", () => ({
  evalTS: vi.fn(),
}));

import { getAeMissingFonts } from "../../plugins/illustrator/panel/src/js/ae-bridge.js";
import { getMissingFonts } from "../../plugins/illustrator/panel/src/js/bridge.js";
import { evalTS } from "../../plugins/illustrator/panel/src/js/lib/utils/bolt.js";

const evalTSMock = vi.mocked(evalTS);

describe("font bridge helpers", () => {
  beforeEach(() => {
    evalTSMock.mockReset();
    vi.restoreAllMocks();
  });

  it("passes raw font mappings to the Illustrator host and returns arrays unchanged", async () => {
    const fonts: FontEntry[] = [{ sourceFont: "ArialMT", family: "Arial, sans-serif" }];
    evalTSMock.mockResolvedValue(["HelveticaNeue-Bold"]);

    const result = await getMissingFonts(fonts);

    expect(result).toEqual(["HelveticaNeue-Bold"]);
    expect(evalTSMock).toHaveBeenCalledWith("getMissingFonts", fonts);
  });

  it("parses stringified host responses before populating the font list", async () => {
    evalTSMock.mockResolvedValue('["ArialMT","HelveticaNeue-Bold"]');

    await expect(getMissingFonts([])).resolves.toEqual(["ArialMT", "HelveticaNeue-Bold"]);
  });

  it("drops unexpected host error strings instead of iterating them as characters", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    evalTSMock.mockResolvedValue("Error 21: undefined is not an object");

    await expect(getMissingFonts([])).resolves.toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("normalizes the After Effects missing-font response the same way", async () => {
    evalTSMock.mockResolvedValue('["ArialMT"]');

    await expect(getAeMissingFonts([], "42")).resolves.toEqual(["ArialMT"]);
    expect(evalTSMock).toHaveBeenCalledWith("getAeMissingFonts", [], "42");
  });
});
