import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CURRENT_IR_VERSION, type Document } from "../../src/ir/types.js";
import {
  bundleToZipBytes,
  createOutputBundle,
  getBundleFile,
  type OutputBundle,
  type OutputBundleOptions,
} from "../../src/output-bundle.js";

function makeDocument(imageOutputPath = "assets"): Document {
  return {
    irVersion: CURRENT_IR_VERSION,
    source: { tool: "svg", toolVersion: "1.0", adapterVersion: "0.1.0" },
    settings: {
      projectName: "sample",
      output: "one-file",
      imageSourcePath: "",
      imageOutputPath,
      htmlOutputPath: "",
    },
    fonts: [],
    artboards: [],
    customBlocks: [],
    assets: {},
    metadata: { slug: "sample" },
  };
}

function makeBundleOptions(overrides: Partial<OutputBundleOptions> = {}): OutputBundleOptions {
  return {
    irDocument: makeDocument(),
    emittedFiles: [{ slug: "sample", extension: ".html", output: "<div>sample</div>" }],
    assetFiles: [{ path: "sample.png", bytes: Uint8Array.from([1, 2, 3]), mimeType: "image/png" }],
    assetRoot: "assets",
    ...overrides,
  };
}

describe("output bundle", () => {
  it("assembles ir, emitted files, and assets into a shared bundle structure", () => {
    const bundle = createOutputBundle(makeBundleOptions());

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

/**
 * Zip-slip. `assetRoot` comes from `settings.imageOutputPath`, which is user text
 * on every surface (`ai2html-settings`, `all2html.config.json`, the CEP panel,
 * the Figma JSONC). Bundle entry paths become **ZIP entry names**
 * (`bundleToZipBytes`, `plugins/figma/src/export.ts`), and Figma hands that ZIP
 * to the user to extract, so a `..` in an entry name writes outside the
 * extraction directory. Bundle assembly used to only collapse separators and
 * left `..` alone, so `imageOutputPath: "../../"` produced exactly that.
 *
 * The CLI's `resolveInsideOutputDir` covers only the CLI's filesystem sink; this
 * is the same rule stated where the paths are built, so every consumer inherits
 * it.
 */
describe("bundle entry paths cannot escape the bundle root", () => {
  /** No representable bundle contains these, so construction refuses them. */
  const hostileRoots = [
    "../../evil",
    "..",
    "a/../../b",
    "../",
    "..\\..\\evil",
    "img/../../../etc",
    "C:/evil",
    "c:evil",
    "img\u0000/evil",
    "img\nevil",
  ];

  it.each(hostileRoots)("refuses assetRoot %j", (assetRoot) => {
    expect(() => createOutputBundle(makeBundleOptions({ assetRoot }))).toThrow(
      /Refusing to build an output bundle/,
    );
  });

  it("names the setting it refused, so the message is actionable", () => {
    expect(() => createOutputBundle(makeBundleOptions({ assetRoot: "../../evil" }))).toThrow(
      /imageOutputPath/,
    );
  });

  it.each(hostileRoots)("refuses an asset path of %j", (path) => {
    expect(() =>
      createOutputBundle(
        makeBundleOptions({
          assetRoot: "",
          assetFiles: [{ path, bytes: Uint8Array.from([1]), mimeType: "image/png" }],
        }),
      ),
    ).toThrow(/Refusing to build an output bundle/);
  });

  it("refuses an emitted file name that escapes", () => {
    expect(() =>
      createOutputBundle(
        makeBundleOptions({
          emittedFiles: [{ slug: "../../evil", extension: ".html", output: "x" }],
        }),
      ),
    ).toThrow(/Refusing to build an output bundle/);
  });

  it.each([
    "ir.json",
    "manifest.json",
  ])("refuses an asset that collides with the reserved %s entry", (path) => {
    expect(() =>
      createOutputBundle(
        makeBundleOptions({
          assetRoot: "",
          assetFiles: [{ path, bytes: Uint8Array.from([9]), mimeType: "application/octet-stream" }],
        }),
      ),
    ).toThrow(/collides.*Bundle entry paths must be unique/);
  });

  it("refuses distinct emitted names that normalize to one entry", () => {
    expect(() =>
      createOutputBundle(
        makeBundleOptions({
          emittedFiles: [
            { slug: "nested//sample", extension: ".html", output: "one" },
            { slug: "nested/sample", extension: ".html", output: "two" },
          ],
        }),
      ),
    ).toThrow(/collides.*Bundle entry paths must be unique/);
  });

  it("classifies an emitted entry by its constructed path, not its raw spelling", () => {
    const bundle = createOutputBundle(
      makeBundleOptions({
        emittedFiles: [{ slug: "/sample", extension: ".html", output: "sample" }],
      }),
    );

    expect(bundle.manifest.files).toContainEqual(
      expect.objectContaining({ path: "sample.html", role: "emitted" }),
    );
  });

  /**
   * `imageOutputPath` is also the `<img src>` prefix, where `/all2html-output/`
   * is an ordinary site-root URL — `test/fixtures/golden-ir/multiple-files-test.json`
   * ships one. Normalization has always dropped the leading slash, which contains
   * the entry; the guarantee added here is that nothing absolute survives it,
   * including the doubled-slash and UNC-looking spellings that used to stop one
   * slash short.
   */
  it.each([
    ["/abs/evil", "abs/evil/sample.png"],
    ["//abs/evil", "abs/evil/sample.png"],
    ["/all2html-output/", "all2html-output/sample.png"],
    ["./nested/", "nested/sample.png"],
    // A UNC-looking value is the doubled-slash case; it is contained, not
    // rejected, for the same reason `/abs` is. A drive letter is not, because
    // `C:/x` is relative on POSIX and absolute on Windows.
    ["\\\\server\\share", "server/share/sample.png"],
  ])("contains an absolute assetRoot %j under the root", (assetRoot, expectedEntry) => {
    const bundle = createOutputBundle(makeBundleOptions({ assetRoot }));
    expect(bundle.files.map((file) => file.path)).toContain(expectedEntry);
    expectContained(bundle);
  });

  /**
   * The boundary the module's own documentation calls legitimate:
   * `imageOutputPath: "/"` is a site-root `<img src>` prefix, and the surfaces
   * hand that same value in as `assetRoot`. A directory that normalizes to
   * nothing is the **bundle root**, not a missing file name — `artifactEntryPath`
   * refuses an empty result because nothing names a file, which is the right rule
   * for an entry and the wrong one for the directory the entries sit under.
   */
  it.each([
    "/",
    "//",
    "\\",
    "./",
  ])("puts assets at the bundle root for a site-root assetRoot %j", (assetRoot) => {
    const bundle = createOutputBundle(makeBundleOptions({ assetRoot }));

    expect(bundle.files.map((file) => file.path)).toEqual([
      "ir.json",
      "manifest.json",
      "sample.html",
      "sample.png",
    ]);
    expectContained(bundle);
    expect(Object.keys(unzipSync(bundleToZipBytes(bundle))).sort()).toEqual(
      bundle.manifest.files.map((file) => file.path).sort(),
    );
  });

  /**
   * The same value with nothing to apply it to. The old branch tested
   * `options.assetRoot` for truthiness, so `"/"` was validated as a file entry
   * and threw even when the document had no assets — a value the run never reads.
   */
  it("builds a bundle with a site-root assetRoot and no assets", () => {
    const bundle = createOutputBundle(makeBundleOptions({ assetRoot: "/", assetFiles: [] }));

    expect(bundle.files.map((file) => file.path)).toEqual([
      "ir.json",
      "manifest.json",
      "sample.html",
    ]);
  });

  /**
   * Containment is asserted on the directory itself, not on the entries it
   * happens to produce: the same string is also the emitted `src` prefix, so a
   * traversing value is refused whether or not this run has assets.
   */
  it("still refuses a hostile assetRoot when there are no assets", () => {
    expect(() =>
      createOutputBundle(makeBundleOptions({ assetRoot: "../../evil", assetFiles: [] })),
    ).toThrow(/Refusing to build an output bundle/);
  });

  it("still builds a legitimate nested asset directory", () => {
    const bundle = createOutputBundle(makeBundleOptions({ assetRoot: "img/graphics/" }));

    expect(bundle.files.map((file) => file.path)).toEqual([
      "img/graphics/sample.png",
      "ir.json",
      "manifest.json",
      "sample.html",
    ]);
    expectContained(bundle);

    // The Output bundle rule: the manifest is the inventory and must match the
    // serialized contents.
    const archive = unzipSync(bundleToZipBytes(bundle));
    expect(bundle.manifest.files.map((file) => file.path).sort()).toEqual(
      Object.keys(archive).sort(),
    );
    expect(JSON.parse(new TextDecoder().decode(archive["manifest.json"]))).toEqual(bundle.manifest);
  });

  /**
   * The sink-side backstop. `OutputBundle` is a public type and the Figma writer
   * builds its own entry names, so the ZIP writers re-assert the rule rather than
   * trusting whoever assembled the file list.
   */
  it("refuses to zip a hand-assembled bundle with an escaping entry", () => {
    const bundle = createOutputBundle(makeBundleOptions());
    const tampered: OutputBundle = {
      ...bundle,
      files: [
        ...bundle.files,
        { path: "../../evil.png", bytes: Uint8Array.from([1]), mimeType: "image/png" },
      ],
    };

    expect(() => bundleToZipBytes(tampered)).toThrow(/Refusing to build an output bundle/);
  });
});

/**
 * `getBundleFile` shares `artifactRelativePath` with construction, so the lookup
 * key has to keep landing on the entry key. Lookups also must not throw — the
 * dropzone calls this with whatever path is selected in its file list.
 */
describe("bundle file lookup is unchanged", () => {
  const bundle = createOutputBundle(makeBundleOptions());

  it.each([
    "assets/sample.png",
    "./assets/sample.png",
    "assets\\sample.png",
    "/assets/sample.png",
    "assets//sample.png",
  ])("resolves %j to the asset entry", (lookup) => {
    expect(getBundleFile(bundle, lookup)?.path).toBe("assets/sample.png");
  });

  it("returns undefined rather than throwing for a path no entry uses", () => {
    expect(getBundleFile(bundle, "../../evil.png")).toBeUndefined();
    expect(getBundleFile(bundle, "nope.html")).toBeUndefined();
  });
});

function expectContained(bundle: OutputBundle): void {
  for (const file of bundle.files) {
    expect(file.path.startsWith("/"), file.path).toBe(false);
    expect(file.path.split("/"), file.path).not.toContain("..");
  }
  for (const file of bundle.manifest.files) {
    expect(file.path.startsWith("/"), file.path).toBe(false);
    expect(file.path.split("/"), file.path).not.toContain("..");
  }
}
