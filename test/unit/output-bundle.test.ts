import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CURRENT_IR_VERSION } from "../../src/ir/types.js";
import { bundleToZipBytes, createOutputBundle, getBundleFile } from "../../src/output-bundle.js";

describe("output bundle", () => {
  it("assembles ir, emitted files, and assets into a shared bundle structure", () => {
    const bundle = createOutputBundle({
      irDocument: {
        irVersion: CURRENT_IR_VERSION,
        source: { tool: "svg", toolVersion: "1.0", adapterVersion: "0.1.0" },
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
      "manifest.json",
      "sample.html",
    ]);
    expect(getBundleFile(bundle, "sample.html")?.text).toContain("sample");
    expect(bundle.manifest.files.map((file) => file.path)).toContain("manifest.json");
    expect(bundle.manifest.source.tool).toBe("svg");

    const archive = unzipSync(bundleToZipBytes(bundle));
    expect(Object.keys(archive).sort()).toEqual([
      "assets/sample.png",
      "ir.json",
      "manifest.json",
      "sample.html",
    ]);
    const serializedManifest = JSON.parse(new TextDecoder().decode(archive["manifest.json"]));
    expect(serializedManifest).toEqual(bundle.manifest);
    expect(serializedManifest.files.map((file: { path: string }) => file.path)).toContain(
      "manifest.json",
    );
  });
});
