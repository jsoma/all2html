#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseConfigText } from "../core/config.js";
import type { ArtboardGroup } from "../core/group-artboards.js";
import { createConsoleLogger, noopLogger } from "../core/logger.js";
import { processDocument } from "../core/pipeline.js";
import { formatGroupedWarnings, groupWarnings, type StructuredWarning } from "../core/warnings.js";
import type { EmitResult } from "../emitters/registry.js";
import { formatDictatedExtension, getAvailableFormats, getEmitter } from "../emitters/registry.js";
import { type EmitterConfig, withAssetBase } from "../emitters/types.js";
import { getImporter } from "../importers/registry.js";
import { loadSVGImportFiles } from "../importers/svg/node.js";
import type { EmitterReadyDocument } from "../ir/types.js";
import { loadAndValidateIR } from "../ir/validate.js";
import { createOutputBundle } from "../output-bundle.js";
import { resolveInsideOutputDir } from "./output-paths.js";

function usage() {
  const formats = getAvailableFormats().join("|");
  console.log(`Usage:
  all2html render <ir.json> -o <output-dir> [--format ${formats}] [--config <config.json>]
  all2html watch <ir.json> -o <output-dir> [--format ${formats}] [--config <config.json>] [--verbose]
  all2html import svg <input> -o <output-dir> [--format ${formats}] [--config <config.json>] [--verbose]
  all2html validate <ir.json>
`);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Print warnings grouped by their declared category, not by prose matching. */
function reportWarnings(warnings: readonly StructuredWarning[]): void {
  if (warnings.length === 0) return;
  console.error(formatGroupedWarnings(groupWarnings(warnings)));
}

function emitAndWrite(
  doc: EmitterReadyDocument,
  groups: ArtboardGroup[],
  format: string,
  outputDir: string,
  emitterConfig?: EmitterConfig,
): EmitResult {
  const emitter = getEmitter(format);
  // Where this command puts the assets relative to the files it writes. Every
  // CLI command writes the emitted files at the root of `-o` and — on `import`,
  // via `createOutputBundle({ assetRoot })` — the assets under
  // `imageOutputPath`, so that directory is the path from one to the other.
  // `render` and `watch` copy no assets at all; they state the same layout so a
  // rendered page and an imported bundle reference an image the same way.
  const result = emitter.emitAll(
    doc,
    groups,
    withAssetBase(emitterConfig, doc.settings.imageOutputPath || ""),
  );
  reportWarnings(result.structuredWarnings);
  const absOutputDir = resolve(outputDir);
  for (const file of result.files) {
    const outPath = resolveInsideOutputDir(absOutputDir, `${file.slug}${file.extension}`);
    writeFileSync(outPath, file.output, "utf-8");
    console.log(`Written: ${outPath}`);
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    usage();
    process.exit(0);
  }

  const command = args[0];

  if (command === "validate") {
    const irPath = args[1];
    if (!irPath) {
      console.error("Error: missing IR file path");
      process.exit(1);
    }
    try {
      const raw = JSON.parse(readFileSync(resolve(irPath), "utf-8"));
      loadAndValidateIR(raw);
      console.log("Valid IR document.");
    } catch (err: unknown) {
      console.error(getErrorMessage(err));
      process.exit(1);
    }
    return;
  }

  if (command === "render") {
    const irPath = args[1];
    if (!irPath) {
      console.error("Error: missing IR file path");
      process.exit(1);
    }

    let outputDir = ".";
    let format = "html";
    let configPath: string | undefined;
    let verbose = false;

    for (let i = 2; i < args.length; i++) {
      if (args[i] === "-o" || args[i] === "--output") {
        outputDir = args[++i];
      } else if (args[i] === "--format") {
        format = args[++i];
      } else if (args[i] === "--config") {
        configPath = args[++i];
      } else if (args[i] === "--verbose" || args[i] === "-v") {
        verbose = true;
      }
    }

    try {
      const logger = verbose ? createConsoleLogger() : noopLogger;
      const raw = JSON.parse(readFileSync(resolve(irPath), "utf-8"));
      // Read before the pipeline runs: the capability check needs the extension
      // this run will actually write, and for react that depends on the emitter
      // configuration rather than on any setting.
      const emitterConfig = configPath
        ? parseConfigText(readFileSync(resolve(configPath), "utf-8"), configPath).emit
        : undefined;
      const {
        document: doc,
        groups,
        structuredWarnings,
      } = processDocument(raw, {
        configPath,
        logger,
        surface: {
          surface: "cli",
          path: "render",
          format,
          formatExtension: formatDictatedExtension(format, emitterConfig),
        },
      });

      reportWarnings(structuredWarnings);

      mkdirSync(resolve(outputDir), { recursive: true });
      emitAndWrite(doc, groups, format, outputDir, emitterConfig);
    } catch (err: unknown) {
      console.error(`Error: ${getErrorMessage(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === "import") {
    const importerName = args[1];
    const inputPath = args[2];
    if (!importerName || !inputPath) {
      console.error("Error: missing importer or input path");
      process.exit(1);
    }

    let outputDir = ".";
    let format = "html";
    let configPath: string | undefined;
    let verbose = false;

    for (let i = 3; i < args.length; i++) {
      if (args[i] === "-o" || args[i] === "--output") {
        outputDir = args[++i];
      } else if (args[i] === "--format") {
        format = args[++i];
      } else if (args[i] === "--config") {
        configPath = args[++i];
      } else if (args[i] === "--verbose" || args[i] === "-v") {
        verbose = true;
      }
    }

    getEmitter(format);

    try {
      const importer = getImporter(importerName);
      const logger = verbose ? createConsoleLogger() : noopLogger;
      const parsedConfig = configPath
        ? parseConfigText(readFileSync(resolve(configPath), "utf-8"), configPath)
        : undefined;
      const loaded =
        importerName === "svg"
          ? loadSVGImportFiles(inputPath)
          : (() => {
              throw new Error(`No loader exists for importer "${importerName}".`);
            })();

      const imported = await importer.importFiles(loaded.files, {
        slug: loaded.slug,
        entrypointPaths: loaded.entrypointPaths,
        settings: parsedConfig?.settings,
      });

      reportWarnings(imported.structuredWarnings);

      const {
        document: doc,
        groups,
        warnings,
        structuredWarnings,
      } = processDocument(imported.document, {
        inlineConfig: parsedConfig,
        logger,
        surface: {
          surface: "cli",
          path: "import",
          format,
          formatExtension: formatDictatedExtension(format, parsedConfig?.emit),
        },
      });
      const emitterConfig = parsedConfig?.emit;

      reportWarnings(structuredWarnings);

      mkdirSync(resolve(outputDir), { recursive: true });
      const emitResult = emitAndWrite(doc, groups, format, outputDir, emitterConfig);
      const bundle = createOutputBundle({
        irDocument: imported.document,
        emittedFiles: emitResult.files,
        assetFiles: imported.assetFiles,
        assetRoot: doc.settings.imageOutputPath || "",
        emittedFormat: format,
        warnings: [...imported.warnings, ...warnings, ...emitResult.warnings],
      });
      const emittedPaths = new Set(emitResult.files.map((file) => `${file.slug}${file.extension}`));
      for (const file of bundle.files) {
        if (emittedPaths.has(file.path)) {
          continue;
        }
        const outPath = resolveInsideOutputDir(resolve(outputDir), file.path);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, file.bytes);
        console.log(`Written: ${outPath}`);
      }
    } catch (err: unknown) {
      console.error(`Error: ${getErrorMessage(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === "watch") {
    const { watch } = await import("node:fs");
    const irPath = args[1];
    if (!irPath) {
      console.error("Error: missing IR file path");
      process.exit(1);
    }

    let outputDir = ".";
    let format = "html";
    let configPath: string | undefined;
    let verbose = false;

    for (let i = 2; i < args.length; i++) {
      if (args[i] === "-o" || args[i] === "--output") outputDir = args[++i];
      else if (args[i] === "--format") format = args[++i];
      else if (args[i] === "--config") configPath = args[++i];
      else if (args[i] === "--verbose" || args[i] === "-v") verbose = true;
    }

    // Validate format early
    getEmitter(format);

    function rebuild() {
      try {
        const logger = verbose ? createConsoleLogger() : noopLogger;
        const raw = JSON.parse(readFileSync(resolve(irPath), "utf-8"));
        const emitterConfig = configPath
          ? parseConfigText(readFileSync(resolve(configPath), "utf-8"), configPath).emit
          : undefined;
        const {
          document: doc,
          groups,
          warnings,
          structuredWarnings,
        } = processDocument(raw, {
          configPath,
          logger,
          surface: {
            surface: "cli",
            path: "render",
            format,
            formatExtension: formatDictatedExtension(format, emitterConfig),
          },
        });
        mkdirSync(resolve(outputDir), { recursive: true });
        reportWarnings(structuredWarnings);
        const emitResult = emitAndWrite(doc, groups, format, outputDir, emitterConfig);
        const totalWarnings = warnings.length + emitResult.warnings.length;
        console.log(`Rebuilt (${totalWarnings} warnings)`);
      } catch (err: unknown) {
        console.error(`Rebuild error: ${getErrorMessage(err)}`);
      }
    }

    rebuild();
    const watchPaths = Array.from(
      new Set([resolve(irPath), ...(configPath ? [resolve(configPath)] : [])]),
    );
    console.log(`Watching ${watchPaths.join(", ")} for changes...`);
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleRebuild = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(rebuild, 200);
    };
    for (const watchPath of watchPaths) {
      watch(watchPath, scheduleRebuild);
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(1);
}

main();
