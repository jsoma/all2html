import { describe, expect, it } from "vitest";
import {
  findMissingConfiguredFonts,
  parseFontConfigEntries,
} from "../../plugins/illustrator/panel/src/jsx/font-config.js";

describe("shared JSX font config helpers", () => {
  it("parses array input, JSON strings, and double-encoded JSON strings", () => {
    const entries = [{ sourceFont: "ArialMT" }];

    expect(parseFontConfigEntries(entries)).toEqual(entries);
    expect(parseFontConfigEntries(JSON.stringify(entries))).toEqual(entries);
    expect(parseFontConfigEntries(JSON.stringify(JSON.stringify(entries)))).toEqual(entries);
    expect(parseFontConfigEntries("not-json")).toEqual([]);
  });

  it("diffs detected fonts against configured sourceFont and legacy aifont aliases", () => {
    expect(
      findMissingConfiguredFonts(
        ["ArialMT", "HelveticaNeue-Bold", "Inter-Regular"],
        JSON.stringify([{ sourceFont: "ArialMT" }, { aifont: "HelveticaNeue-Bold" }]),
      ),
    ).toEqual(["Inter-Regular"]);
  });
});
