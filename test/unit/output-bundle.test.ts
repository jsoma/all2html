import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { bundleToZipBytes, createOutputBundle, getBundleFile } from "../../src/output-bundle.js";

describe("output bundle", () => {
  it("assembles ir, emitted files, and assets into a shared bundle structure", () => {
    const bundle = createOutputBundle({
      irDocument: {
        irVersion: "0.0.0",
        generator: { tool: "svg", toolVersion: "1.0", pluginVersion: "0.1.0" },
        settings: {
          projectName: "sample",
          output: "one-file",
          imageSourcePath: "",
          imageOutputPath: "assets",
          htmlOutputPath: "",
        },
        fonts: [],
        artboards: [],
        customBlocks: [],
        assets: {},
        metadata: { slug: "sample" },
      },
      emittedFiles: [{ slug: "sample", extension: ".html", output: "<div>sample</div>" }],
      assetFiles: [
        { path: "sample.png", bytes: Uint8Array.from([1, 2, 3]), mimeType: "image/png" },
      ],
      assetRoot: "assets",
    });

    expect(bundle.files.map((file) => file.path)).toEqual([
      "assets/sample.png",
      "ir.json",
      "sample.html",
    ]);
    expect(getBundleFile(bundle, "sample.html")?.text).toContain("sample");

    const archive = unzipSync(bundleToZipBytes(bundle));
    expect(Object.keys(archive).sort()).toEqual(["assets/sample.png", "ir.json", "sample.html"]);
  });
});
