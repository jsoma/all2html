import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { convertLoadedSvgFilesInBrowser, getBrowserEmitter } from "../../src/browser.js";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { CURRENT_IR_VERSION, type Document, type Settings } from "../../src/ir/types.js";
import { ensureFreshArtifact } from "../helpers/extendscript-build.js";

/**
 * One document, every surface's **real** entry point.
 *
 * The gap this closes: `output: "multiple-files"` was a no-op on Illustrator for
 * as long as the setting existed, and the whole test suite was green throughout —
 * because every grouping test called `processDocument()` and the emitter registry
 * directly, which is the CLI's path and nobody else's. `src/extendscript/index.ts`
 * ran its own hardcoded pipeline ending in a single `emitHTMLString(ready)`, and
 * no test ever called it with a multi-group document. The `multiple-files-test`
 * hardening fixture "passed" while the real export wrote one file.
 *
 * So the rule for this file: assert **file count, filenames and format** through
 * the entry point each surface actually runs, never through a shared helper the
 * surface might not reach. A test that reaches past the entry point re-proves the
 * core and proves nothing about the wiring.
 *
 * TODO(figma): `plugins/figma/src/export.ts` is the fourth entry point and belongs
 * in this file — it emits html + standalone through the shared registry and has
 * its own group handling. Left out only because that file is being edited in
 * parallel right now; add it here rather than in a Figma-only test.
 */

const rootDir = resolve(import.meta.dirname, "../..");
const bundleRelativePath = "dist/extendscript/all2html-core.js";

interface EmittedFile {
  slug: string;
  extension: string;
  output: string;
}

interface BundleProcessResult {
  html: string;
  files: EmittedFile[];
  warnings: string[];
}

/** The shipped ExtendScript artifact, evaluated exactly as Illustrator does. */
function loadExtendScriptBundle(): {
  processAndEmit: (doc: Document, config?: unknown) => BundleProcessResult;
} {
  const artifactPath = ensureFreshArtifact(bundleRelativePath, "build:extendscript");
  const code = readFileSync(artifactPath, "utf-8");
  return new Function(`${code}\nreturn All2Html;`)();
}

/**
 * Two artboard base names, two widths each: four artboards that collapse to one
 * file in `one-file` mode and two files in `multiple-files` mode. The width pairs
 * matter — a group is a responsive set, so "one file per group" and "one file per
 * artboard" have to be distinguishable.
 *
 * Built by widening the tracked `multiple-files-output.json` rather than by hand,
 * so it cannot drift out of the IR schema while these surfaces keep validating
 * against it.
 */
const baseFixture: Document = JSON.parse(
  readFileSync(resolve(rootDir, "test/fixtures/ir/multiple-files-output.json"), "utf-8"),
);

/** Every element variant except `video` carries an id; the fixture has no videos. */
function elementId(element: object): string {
  return "id" in element && typeof element.id === "string" ? element.id : "element";
}

function multiGroupDocument(output: "one-file" | "multiple-files"): Document {
  const doc = structuredClone(baseFixture);
  const artboards = doc.artboards.flatMap((artboard) =>
    [1, 1.5].map((scale) => {
      const width = Math.round(artboard.width * scale);
      const wide = structuredClone(artboard);
      wide.id = `artboard:${artboard.name}-${width}`;
      wide.width = width;
      wide.source = { ...artboard.source, tool: "test", name: `${artboard.name}--${width}`, width };
      wide.layers = wide.layers.map((layer) => ({
        ...layer,
        id: `${wide.id}:${layer.id}`,
        elements: layer.elements.map((element) => ({
          ...element,
          id: `${wide.id}:${elementId(element)}`,
        })),
      }));
      return wide;
    }),
  );

  return {
    ...doc,
    settings: { ...doc.settings, output },
    artboards,
    metadata: { ...doc.metadata, slug: "entrypoints" },
    irVersion: CURRENT_IR_VERSION,
  };
}

/**
 * One artboard with one background image, for the other half of "what does this
 * surface actually write": where the emitted `<img src>` points, relative to
 * where the surface puts the file. The asset path is a bare filename, as every
 * producer writes it — the directory is the surface's business, stated as the
 * `assetBase` emitter option, never inferred from `imageOutputPath`.
 */
const assetFixture: Document = JSON.parse(
  readFileSync(resolve(rootDir, "test/fixtures/ir/single-artboard-basic.json"), "utf-8"),
);

function assetDocument(settings: Partial<Settings>): Document {
  const doc = structuredClone(assetFixture);
  return {
    ...doc,
    settings: { ...doc.settings, ...settings },
    irVersion: CURRENT_IR_VERSION,
  };
}

function imageSrcs(html: string): string[] {
  return Array.from(html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)).map((match) => match[1]);
}

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "all2html-entrypoints-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Illustrator entry point (ExtendScript bundle processAndEmit)", () => {
  it("emits exactly one file in one-file mode, named after the document", () => {
    const { processAndEmit } = loadExtendScriptBundle();
    const result = processAndEmit(multiGroupDocument("one-file"));

    expect(result.files.map((file) => `${file.slug}${file.extension}`)).toEqual([
      "entrypoints.html",
    ]);
    expect(result.files[0].output).toContain("Chart Title");
    expect(result.files[0].output).toContain("Map Title");
  });

  it("emits one file per artboard group in multiple-files mode", () => {
    const { processAndEmit } = loadExtendScriptBundle();
    const result = processAndEmit(multiGroupDocument("multiple-files"));

    expect(result.files.map((file) => `${file.slug}${file.extension}`)).toEqual([
      "entrypoints-chart.html",
      "entrypoints-map.html",
    ]);

    const [chart, map] = result.files;
    expect(chart.output).toContain("Chart Title");
    expect(chart.output).not.toContain("Map Title");
    expect(map.output).toContain("Map Title");
    expect(map.output).not.toContain("Chart Title");
    // Both artboards of the group ride in the group's file: it is a responsive
    // set, not one file per artboard.
    expect(chart.output).toContain('id="g-entrypoints-chart-box"');
    expect((chart.output.match(/-box"/g) || []).length).toBeGreaterThan(0);
  });

  it("keeps `html` as the first file, and one-file output byte-identical to the ungrouped emit", () => {
    const { processAndEmit } = loadExtendScriptBundle();
    const raw = multiGroupDocument("one-file");
    const result = processAndEmit(structuredClone(raw));

    // `exporter.jsx` and the panel's result envelope predate `files`.
    expect(result.html).toBe(result.files[0].output);

    // Grouping must not have changed what a default export looks like.
    const { document: nodeDoc } = processDocument(structuredClone(raw));
    expect(result.html).toBe(emitHTML(nodeDoc).html);
  });

  it("carries the requested html extension onto every emitted file", () => {
    const { processAndEmit } = loadExtendScriptBundle();
    const raw = multiGroupDocument("multiple-files");
    raw.settings.htmlOutputExtension = ".php";
    const result = processAndEmit(raw);

    expect(result.files.map((file) => file.extension)).toEqual([".php", ".php"]);
  });
  /**
   * `exporter.jsx:1803-1806` computes ONE output directory —
   * `docPath + (html_output_path || image_output_path || "all2html-output/")` —
   * and writes the HTML *and* every image into it. The page and its images are
   * siblings, so the only `src` that resolves is a bare filename.
   *
   * The emitter used to derive the prefix from `imageOutputPath`, which is a
   * filesystem directory and not a statement about the markup at all; on this
   * surface it prefixed `src` with the directory the HTML was already inside and
   * every image 404'd. That was papered over by clearing the setting before
   * emit — a layout fact encoded by mutating a user-visible setting. Restoring
   * the old fallback fails this test.
   */
  it("emits image src as a bare filename, whatever imageOutputPath says", () => {
    const { processAndEmit } = loadExtendScriptBundle();

    const result = processAndEmit(assetDocument({ imageOutputPath: "custom-images/" }));

    expect(imageSrcs(result.html)).toEqual(["test-desktop.png"]);
  });

  it("exports the shared output-directory constructor and refuses traversal", () => {
    const core = loadExtendScriptBundle() as ReturnType<typeof loadExtendScriptBundle> & {
      relativeOutputDirectory: (path: string) => string;
    };

    expect(core.relativeOutputDirectory("nested/output")).toBe("nested/output/");
    expect(() => core.relativeOutputDirectory("../../outside")).toThrow(
      /Artifact paths must stay inside/,
    );
  });

  /**
   * The user's own prefix still wins, verbatim. That is ai2html's split:
   * `image_output_path` is where the files go, `image_source_path` is what goes
   * in `<img src>`, and the NYT configs ship them set to different values.
   */
  it("honors imageSourcePath verbatim, because that is the user's src prefix", () => {
    const { processAndEmit } = loadExtendScriptBundle();

    const result = processAndEmit(
      assetDocument({
        imageOutputPath: "custom-images/",
        imageSourcePath: "https://cdn.example.com/_assets/",
      }),
    );

    expect(imageSrcs(result.html)).toEqual(["https://cdn.example.com/_assets/test-desktop.png"]);
  });
});

describe("CLI entry point (src/cli/index.ts render)", () => {
  function runCli(irPath: string, outputDir: string, format: string) {
    return spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli/index.ts",
        "render",
        irPath,
        "-o",
        outputDir,
        "--format",
        format,
      ],
      { cwd: rootDir, encoding: "utf-8" },
    );
  }

  it("writes one file per group for html, and one file in one-file mode", () => {
    withTempDir((dir) => {
      const irPath = join(dir, "ir.json");
      writeFileSync(irPath, JSON.stringify(multiGroupDocument("multiple-files")), "utf-8");
      const many = runCli(irPath, join(dir, "many"), "html");
      expect(many.status, many.stderr).toBe(0);
      expect(readFileSync(join(dir, "many", "entrypoints-chart.html"), "utf-8")).toContain(
        "Chart Title",
      );
      expect(readFileSync(join(dir, "many", "entrypoints-map.html"), "utf-8")).toContain(
        "Map Title",
      );

      writeFileSync(irPath, JSON.stringify(multiGroupDocument("one-file")), "utf-8");
      const one = runCli(irPath, join(dir, "one"), "html");
      expect(one.status, one.stderr).toBe(0);
      const single = readFileSync(join(dir, "one", "entrypoints.html"), "utf-8");
      expect(single).toContain("Chart Title");
      expect(single).toContain("Map Title");
    });
  }, 60_000);

  /**
   * The sink, not the setting.
   *
   * `htmlOutputExtension` is sanitized in the emitter now, so this asserts the
   * belt as well as the braces: with a hostile extension the run still succeeds,
   * every file lands inside `-o`, and nothing appears in the parent directory.
   * The old normalization turned `/../../outside.txt` into `./../../outside.txt`
   * and `join()` walked straight out of the chosen folder.
   */
  it("cannot be made to write outside -o by htmlOutputExtension", () => {
    withTempDir((dir) => {
      const irPath = join(dir, "ir.json");
      const doc = multiGroupDocument("multiple-files");
      doc.settings.htmlOutputExtension = "/../../outside.txt";
      writeFileSync(irPath, JSON.stringify(doc), "utf-8");

      const outputDir = join(dir, "nested", "out");
      const result = runCli(irPath, outputDir, "html");

      expect(result.status, result.stderr).toBe(0);
      expect(readdirSync(outputDir).sort()).toEqual([
        "entrypoints-chart.html",
        "entrypoints-map.html",
      ]);
      // Nothing above the output directory, at either level.
      expect(readdirSync(join(dir, "nested"))).toEqual(["out"]);
      expect(readdirSync(dir).sort()).toEqual(["ir.json", "nested"]);
      // And the user is told, rather than silently getting .html.
      expect(result.stderr).toContain("htmlOutputExtension");
    });
  }, 60_000);

  it("keeps the per-format extension when grouping (svelte)", () => {
    withTempDir((dir) => {
      const irPath = join(dir, "ir.json");
      writeFileSync(irPath, JSON.stringify(multiGroupDocument("multiple-files")), "utf-8");
      const result = runCli(irPath, join(dir, "out"), "svelte");
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(dir, "out", "entrypoints-chart.svelte"), "utf-8")).toContain(
        "Chart Title",
      );
      expect(readFileSync(join(dir, "out", "entrypoints-map.svelte"), "utf-8")).toContain(
        "Map Title",
      );
    });
  }, 60_000);
});

describe("browser entry point (convertLoadedSvgFilesInBrowser)", () => {
  /**
   * Real orchestration, real pipeline, real browser emitter registry; only the
   * SVG import is stubbed, because the thing under test is what the browser
   * surface does with the groups, not how it parses SVG.
   */
  async function convert(output: "one-file" | "multiple-files", format: string) {
    return convertLoadedSvgFilesInBrowser({
      loaded: {
        slug: "entrypoints",
        entrypointPaths: ["entrypoints.svg"],
        files: [{ path: "entrypoints.svg", content: "<svg />", mimeType: "image/svg+xml" }],
      },
      format,
      rasterizer: {
        rasterizeSvg() {
          throw new Error("not used");
        },
      },
      importFiles: async () => ({
        document: multiGroupDocument(output),
        assetFiles: [],
        warnings: [],
        structuredWarnings: [],
      }),
      emitter: getBrowserEmitter,
    });
  }

  it("emits one file per group, and the bundle manifest lists all of them", async () => {
    const result = await convert("multiple-files", "html");

    expect(result.groupCount).toBe(2);
    expect(result.filePaths).toEqual(["entrypoints-chart.html", "entrypoints-map.html"]);
    for (const path of result.filePaths) {
      expect(result.bundle.files.map((file) => file.path)).toContain(path);
    }
  });

  it("emits a single standalone document in one-file mode", async () => {
    const result = await convert("one-file", "standalone");

    expect(result.filePaths).toEqual(["entrypoints.html"]);
    const emitted = result.bundle.files.find((file) => file.path === "entrypoints.html");
    expect(new TextDecoder().decode(emitted?.bytes)).toContain("<!DOCTYPE html>");
  });

  it("emits one standalone document per group in multiple-files mode", async () => {
    const result = await convert("multiple-files", "standalone");

    expect(result.filePaths).toEqual(["entrypoints-chart.html", "entrypoints-map.html"]);
  });

  /**
   * The bundle-producing half of the same question. `createOutputBundle` puts
   * the emitted files at the bundle root and every asset at
   * `assetRoot + asset.path`, with `assetRoot` coming from `imageOutputPath` —
   * so here, and unlike Illustrator, that directory *is* the path from the page
   * to the image. The orchestration reads it once and hands it to both sides;
   * this asserts they agree, for a non-default value, through the real entry
   * point.
   */
  async function convertWithAsset(settings: Partial<Settings>) {
    return convertLoadedSvgFilesInBrowser({
      loaded: {
        slug: "entrypoints",
        entrypointPaths: ["entrypoints.svg"],
        files: [{ path: "entrypoints.svg", content: "<svg />", mimeType: "image/svg+xml" }],
      },
      format: "html",
      rasterizer: {
        rasterizeSvg() {
          throw new Error("not used");
        },
      },
      importFiles: async () => ({
        document: assetDocument(settings),
        // The byte sidecar names the canonical asset (`bg-desktop` in the
        // fixture); its path and MIME come from the asset record.
        assetFiles: [
          {
            assetId: "bg-desktop",
            bytes: new TextEncoder().encode("png-bytes"),
          },
        ],
        warnings: [],
        structuredWarnings: [],
      }),
      emitter: getBrowserEmitter,
    });
  }

  it("points every img src at a file the bundle actually contains", async () => {
    const result = await convertWithAsset({ imageOutputPath: "img/nested/" });

    const emitted = result.bundle.files.find((file) => file.path === result.emittedPath);
    const srcs = imageSrcs(new TextDecoder().decode(emitted?.bytes));
    expect(srcs).toEqual(["img/nested/test-desktop.png"]);
    for (const src of srcs) {
      expect(result.bundle.files.map((file) => file.path)).toContain(src);
    }
    // The manifest slug comes from the *resolved* document: no projectName in
    // the fixture, so it falls back to the document slug — the same pair the
    // output files are named from.
    expect(result.bundle.manifest.slug).toBe("test-graphic");
  });

  it("constructs the same asset path when imageOutputPath omits its trailing slash", async () => {
    const result = await convertWithAsset({ imageOutputPath: "img/nested" });

    const emitted = result.bundle.files.find((file) => file.path === result.emittedPath);
    expect(imageSrcs(new TextDecoder().decode(emitted?.bytes))).toEqual([
      "img/nested/test-desktop.png",
    ]);
    expect(result.bundle.files.map((file) => file.path)).toContain("img/nested/test-desktop.png");
  });

  /**
   * The NYT shape: the two paths deliberately disagree, because one is a
   * filesystem directory and the other is a URL. `src` follows the user's
   * `imageSourcePath`; the bytes still ship under `imageOutputPath`.
   */
  it("lets imageSourcePath point src away from the bundle without moving the bytes", async () => {
    const result = await convertWithAsset({
      imageOutputPath: "public/_assets/",
      imageSourcePath: "/_assets/",
    });

    const emitted = result.bundle.files.find((file) => file.path === result.emittedPath);
    expect(imageSrcs(new TextDecoder().decode(emitted?.bytes))).toEqual([
      "/_assets/test-desktop.png",
    ]);
    expect(result.bundle.files.map((file) => file.path)).toContain(
      "public/_assets/test-desktop.png",
    );
  });
});
