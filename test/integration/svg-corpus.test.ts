import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { importSVGFilesFromNode, loadSVGImportFiles } from "../../src/importers/svg/node.js";

interface CorpusExpectation {
  entrypoints: string[];
  artboards: number;
  warnings: string[];
  assets: string[];
}

const fixturesDir = resolve(import.meta.dirname, "../fixtures/svg");
const expectations = JSON.parse(
  readFileSync(resolve(fixturesDir, "corpus-expectations.json"), "utf-8"),
) as Record<string, CorpusExpectation>;

describe("svg corpus", () => {
  for (const [name, expectation] of Object.entries(expectations)) {
    it(name, async () => {
      const loaded = loadSVGImportFiles(fixturesDir);
      const result = await importSVGFilesFromNode(loaded.files, {
        slug: name.split("/").pop(),
        entrypointPaths: expectation.entrypoints,
      });

      expect(result.document.artboards).toHaveLength(expectation.artboards);
      expect(result.warnings).toEqual(expectation.warnings);
      expect(result.assetFiles.map((asset) => asset.assetId).sort()).toEqual(
        expectation.assets.slice().sort(),
      );
    });
  }
});
