import { describe, expect, it } from "vitest";
import {
  artifactAssetBase,
  artifactEntryPath,
  relativeOutputDirectory,
} from "../../src/core/artifact-path.js";

describe("artifact path constructors", () => {
  it("makes an asset directory safe to concatenate and preserves site-root intent", () => {
    expect(artifactAssetBase("assets")).toBe("assets/");
    expect(artifactAssetBase("assets/")).toBe("assets/");
    expect(artifactAssetBase("/assets")).toBe("/assets/");
  });

  it.each([
    "../outside",
    "nested/../../outside",
    "C:/outside",
    "bad\u0000path",
  ])("refuses unsafe path %j at every path boundary", (path) => {
    expect(() => artifactEntryPath(path)).toThrow(/Artifact paths must stay inside/);
    expect(() => artifactAssetBase(path)).toThrow(/Artifact paths must stay inside/);
    expect(() => relativeOutputDirectory(path)).toThrow(/Artifact paths must stay inside/);
  });

  it("contains Illustrator output below the document directory", () => {
    expect(relativeOutputDirectory("/all2html-output")).toBe("all2html-output/");
    expect(relativeOutputDirectory("nested\\output")).toBe("nested/output/");
  });

  it.each(["", "/", "./"])("refuses empty file entry %j", (path) => {
    expect(() => artifactEntryPath(path)).toThrow(/does not name a file/);
  });
});
