import { describe, expect, it } from "vitest";
import {
  artifactAssetBase,
  artifactEntryDirectory,
  artifactEntryPath,
  artifactRelativePath,
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

  /**
   * `artifactRelativePath` is the one spelling rule for a path *below* an
   * artifact root. Both readers of an asset's path go through it — the emitter,
   * which prefixes it with the surface's `<img src>` base, and bundle assembly,
   * which prefixes it with the ZIP directory — so the emitted reference and the
   * entry it names cannot be spelled differently.
   */
  it.each([
    ["x.png", "x.png"],
    ["/x.png", "x.png"],
    ["./x.png", "x.png"],
    ["a//b.png", "a/b.png"],
    ["a\\b.png", "a/b.png"],
    ["nested/x.png/", "nested/x.png"],
  ])("normalizes relative path %j to %j", (path, expected) => {
    expect(artifactRelativePath(path)).toBe(expected);
    // `artifactEntryPath` is that rule plus containment plus "names a file", so
    // the two agree wherever the entry form is legal at all.
    expect(artifactEntryPath(path)).toBe(expected);
  });

  /**
   * A directory is not a file: normalizing to nothing means "the artifact root",
   * which is exactly the `imageOutputPath: "/"` case. The URL half keeps the
   * leading slash because a site-root `src` needs it; the entry half cannot,
   * because a ZIP has nothing above its root.
   */
  it("treats a directory that normalizes away as the artifact root", () => {
    expect(artifactEntryDirectory("")).toBe("");
    expect(artifactEntryDirectory("/")).toBe("");
    expect(artifactEntryDirectory("//")).toBe("");
    expect(artifactEntryDirectory("/img/")).toBe("img");
    expect(artifactEntryDirectory("img/graphics")).toBe("img/graphics");

    expect(artifactAssetBase("/")).toBe("/");
    expect(artifactAssetBase("/img/")).toBe("/img/");
  });

  it.each(["../outside", "C:/outside", "bad\u0000path"])("refuses unsafe directory %j", (path) => {
    expect(() => artifactEntryDirectory(path)).toThrow(/Artifact paths must stay inside/);
  });
});
