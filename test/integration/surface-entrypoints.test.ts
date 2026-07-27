import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { convertLoadedSvgFilesInBrowser, getBrowserEmitter } from "../../src/browser.js";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTMLString } from "../../src/emitters/html-string.js";
import { CURRENT_IR_VERSION, type Document } from "../../src/ir/types.js";
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
    expect(result.html).toBe(emitHTMLString(nodeDoc).html);
  });

  it("carries the requested html extension onto every emitted file", () => {
    const { processAndEmit } = loadExtendScriptBundle();
    const raw = multiGroupDocument("multiple-files");
    raw.settings.htmlOutputExtension = ".php";
    const result = processAndEmit(raw);

    expect(result.files.map((file) => file.extension)).toEqual([".php", ".php"]);
  });
});

describe("CLI entry point (src/cli/index.ts render)", () => {
  function runCli(irPath: string, outputDir: string, format: string) {
    return spawnSync(
      "pnpm",
      ["exec", "tsx", "src/cli/index.ts", "render", irPath, "-o", outputDir, "--format", format],
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
});
