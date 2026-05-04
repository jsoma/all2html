import { describe, expect, it } from "vitest";
import { makeArtboardKey, makeKeyword } from "../../src/core/identifiers.js";

describe("identifier helpers", () => {
  it("creates non-empty CSS-safe keywords", () => {
    expect(makeKeyword("Hero / Desktop")).toBe("hero-desktop");
    expect(makeKeyword("123 Graphic")).toBe("x-123-graphic");
    expect(makeKeyword("!!!", "graphic")).toBe("graphic");
  });

  it("keeps artboard keys unique after sanitization", () => {
    const artboards = [
      { name: "Hero!", originalName: "Hero!", width: 640 },
      { name: "Hero", originalName: "Hero", width: 1024 },
      { name: "!!!", originalName: "!!!", width: 320 },
      { name: "!!!", originalName: "!!!", width: 640 },
    ];

    expect(artboards.map((artboard) => makeArtboardKey(artboard, artboards))).toEqual([
      "hero",
      "hero-2",
      "x-320",
      "x-640",
    ]);
  });
});
