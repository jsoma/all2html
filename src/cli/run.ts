import { mkdirSync, readFileSync, watch as watchFile, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { artifactAssetBase } from "../core/artifact-path.js";
import type { ArtboardGroup } from "../core/group-artboards.js";
import { createConsoleLogger, noopLogger } from "../core/logger.js";
import { processDocument } from "../core/pipeline.js";
import { formatGroupedWarnings, groupWarnings, type StructuredWarning } from "../core/warnings.js";
import type { EmitResult } from "../emitters/registry.js";
import { formatDictatedExtension, getAvailableFormats, getEmitter } from "../emitters/registry.js";
import { type EmitterConfig, withAssetBase } from "../emitters/types.js";
import { importSVGFilesFromNode, loadSVGImportFiles } from "../importers/svg/node.js";
import type { EmitterReadyDocument } from "../ir/types.js";
import { loadAndValidateIR } from "../ir/validate.js";
import { createOutputBundle, resolvedManifestSlug } from "../output-bundle.js";
import { readConfigFile } from "./config-file.js";
import { resolveInsideOutputDir } from "./output-paths.js";

function usage(): void {
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

interface CommandOptions {
  outputDir: string;
  format: string;
  configPath?: string;
  verbose: boolean;
}

/**
 * The one argument grammar, shared by all four commands (`validate` included —
 * it used to read `args[1]` and silently ignore everything after it). Strict on
 * purpose: an unknown flag, a duplicated scalar flag, a flag missing its value,
 * or a stray positional each error concisely instead of last-winning or riding
 * an `undefined` into the pipeline as an unhandled rejection.
 */
function parseCommandArgs(
  command: string,
  args: readonly string[],
  positionalNames: readonly string[],
  allowFlags: boolean,
): { positionals: string[]; options: CommandOptions } {
  const SCALAR_FLAGS: Record<string, "outputDir" | "format" | "configPath"> = {
    "-o": "outputDir",
    "--output": "outputDir",
    "--format": "format",
    "--config": "configPath",
  };
  const BOOLEAN_FLAGS: Record<string, "verbose"> = {
    "--verbose": "verbose",
    "-v": "verbose",
  };

  const positionals: string[] = [];
  const options: CommandOptions = { outputDir: ".", format: "html", verbose: false };
  const seenScalars = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }

    const scalarKey = Object.hasOwn(SCALAR_FLAGS, arg) ? SCALAR_FLAGS[arg] : undefined;
    const booleanKey = Object.hasOwn(BOOLEAN_FLAGS, arg) ? BOOLEAN_FLAGS[arg] : undefined;
    if (!allowFlags || (scalarKey === undefined && booleanKey === undefined)) {
      throw new Error(`unknown option "${arg}" for "${command}"`);
    }

    if (scalarKey !== undefined) {
      if (seenScalars.has(scalarKey)) {
        throw new Error(`option "${arg}" was given more than once`);
      }
      seenScalars.add(scalarKey);
      const value = args[i + 1];
      if (value === undefined || (value.startsWith("-") && value !== "-")) {
        throw new Error(`missing value for "${arg}"`);
      }
      options[scalarKey] = value;
      i++;
      continue;
    }

    if (booleanKey !== undefined) {
      options[booleanKey] = true;
    }
  }

  if (positionals.length < positionalNames.length) {
    throw new Error(`missing ${positionalNames[positionals.length]} for "${command}"`);
  }
  if (positionals.length > positionalNames.length) {
    throw new Error(`unexpected argument "${positionals[positionalNames.length]}"`);
  }

  return { positionals, options };
}

interface PlannedWrite {
  path: string;
  data: string | Uint8Array;
}

/**
 * The write half, all-or-nothing at the *planning* level: every destination is
 * resolved and containment-checked before the first directory or file is
 * created, so a hostile path means zero writes — not "file 1 is on disk before
 * file 2's check throws". A mid-write I/O failure is still reported rather than
 * rolled back; there is deliberately no transaction layer.
 */
export function writePlannedFiles(outputDir: string, files: readonly PlannedWrite[]): void {
  const absOutputDir = resolve(outputDir);
  const planned = files.map((file) => ({
    outPath: resolveInsideOutputDir(absOutputDir, file.path),
    data: file.data,
  }));
  for (const file of planned) {
    mkdirSync(dirname(file.outPath), { recursive: true });
    writeFileSync(file.outPath, file.data);
    console.log(`Written: ${file.outPath}`);
  }
}

/** The emit half: pure, in-memory, no filesystem. */
function emitFiles(
  doc: EmitterReadyDocument,
  groups: ArtboardGroup[],
  format: string,
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
    withAssetBase(emitterConfig, artifactAssetBase(doc.settings.imageOutputPath || "")),
  );
  reportWarnings(result.structuredWarnings);
  return result;
}

/**
 * One render pass: read the IR, read the config **once**, process, emit in
 * memory, then write. Shared by `render` and every `watch` rebuild.
 */
function renderOnce(irPath: string, options: CommandOptions): { warningCount: number } {
  const logger = options.verbose ? createConsoleLogger() : noopLogger;
  // Read once per run/rebuild. The parsed object serves both the emitter config
  // and — as inline config — the pipeline's settings resolution; the old shape
  // parsed the file here for `.emit` and re-read the same path inside the
  // pipeline, with a torn-read window between the two reads.
  const config = options.configPath ? readConfigFile(options.configPath) : undefined;
  const emitterConfig = config?.emit;
  const raw = JSON.parse(readFileSync(resolve(irPath), "utf-8"));
  const {
    document: doc,
    groups,
    warnings,
    structuredWarnings,
  } = processDocument(raw, {
    inlineConfig: config,
    logger,
    surface: {
      surface: "cli",
      path: "render",
      format: options.format,
      formatExtension: formatDictatedExtension(options.format, emitterConfig),
    },
  });
  reportWarnings(structuredWarnings);

  const emitted = emitFiles(doc, groups, options.format, emitterConfig);
  writePlannedFiles(
    options.outputDir,
    emitted.files.map((file) => ({ path: `${file.slug}${file.extension}`, data: file.output })),
  );
  return { warningCount: warnings.length + emitted.warnings.length };
}

async function importCommand(
  importerName: string,
  inputPath: string,
  options: CommandOptions,
): Promise<void> {
  getEmitter(options.format);

  // There is exactly one importer. The registry that used to sit here was
  // deleted: this loader branch already rejected every other name, so a
  // registered importer could never have run.
  if (importerName !== "svg") {
    throw new Error(`unknown importer: "${importerName}". Available: svg`);
  }

  const logger = options.verbose ? createConsoleLogger() : noopLogger;
  const config = options.configPath ? readConfigFile(options.configPath) : undefined;
  const loaded = loadSVGImportFiles(inputPath);

  const imported = await importSVGFilesFromNode(loaded.files, {
    slug: loaded.slug,
    entrypointPaths: loaded.entrypointPaths,
    settings: config?.settings,
  });

  reportWarnings(imported.structuredWarnings);

  const {
    document: doc,
    groups,
    warnings,
    structuredWarnings,
  } = processDocument(imported.document, {
    inlineConfig: config,
    logger,
    surface: {
      surface: "cli",
      path: "import",
      format: options.format,
      formatExtension: formatDictatedExtension(options.format, config?.emit),
    },
  });

  reportWarnings(structuredWarnings);

  // Emit in memory, construct and validate the complete bundle — containment,
  // path uniqueness, asset-byte reconciliation — and only then write. The old
  // order wrote the emitted files first, so a bundle that failed validation
  // had already replaced the prior output.
  const emitted = emitFiles(doc, groups, options.format, config?.emit);
  const bundle = createOutputBundle({
    irDocument: imported.document,
    emittedFiles: emitted.files,
    assetFiles: imported.assetFiles,
    assetRoot: artifactAssetBase(doc.settings.imageOutputPath || ""),
    slug: resolvedManifestSlug(doc),
    emittedFormat: options.format,
    warnings: [...imported.warnings, ...warnings, ...emitted.warnings],
  });
  writePlannedFiles(
    options.outputDir,
    bundle.files.map((file) => ({ path: file.path, data: file.bytes })),
  );
}

export interface WatchHandle {
  close(): void;
}

function watchCommand(irPath: string, options: CommandOptions): WatchHandle {
  // Validate format early
  getEmitter(options.format);

  function rebuild(): void {
    try {
      const { warningCount } = renderOnce(irPath, options);
      console.log(`Rebuilt (${warningCount} warnings)`);
    } catch (err: unknown) {
      // A failed rebuild leaves the last successful output untouched: nothing
      // was written, because every write happens after emit + validation.
      console.error(`Rebuild error: ${getErrorMessage(err)}`);
    }
  }

  rebuild();
  const watchPaths = Array.from(
    new Set([resolve(irPath), ...(options.configPath ? [resolve(options.configPath)] : [])]),
  );
  console.log(`Watching ${watchPaths.join(", ")} for changes...`);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const scheduleRebuild = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(rebuild, 200);
  };
  const watchers = watchPaths.map((watchPath) => watchFile(watchPath, scheduleRebuild));
  return {
    close() {
      if (debounce) clearTimeout(debounce);
      for (const watcher of watchers) watcher.close();
    },
  };
}

/**
 * The whole CLI, minus process concerns: throws instead of exiting, so the bin
 * entry (`index.ts`) owns the `Error: <message>` + exit-1 contract and tests
 * drive commands in-process. `watch` returns a handle so a caller can stop the
 * watchers.
 */
export async function runCli(args: readonly string[]): Promise<WatchHandle | undefined> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    usage();
    return undefined;
  }

  const command = args[0];
  const rest = args.slice(1);

  if (command === "validate") {
    const {
      positionals: [irPath],
    } = parseCommandArgs(command, rest, ["IR file path"], false);
    const raw = JSON.parse(readFileSync(resolve(irPath), "utf-8"));
    loadAndValidateIR(raw);
    console.log("Valid IR document.");
    return undefined;
  }

  if (command === "render") {
    const {
      positionals: [irPath],
      options,
    } = parseCommandArgs(command, rest, ["IR file path"], true);
    renderOnce(irPath, options);
    return undefined;
  }

  if (command === "import") {
    const {
      positionals: [importerName, inputPath],
      options,
    } = parseCommandArgs(command, rest, ["importer name", "input path"], true);
    await importCommand(importerName, inputPath, options);
    return undefined;
  }

  if (command === "watch") {
    const {
      positionals: [irPath],
      options,
    } = parseCommandArgs(command, rest, ["IR file path"], true);
    return watchCommand(irPath, options);
  }

  usage();
  throw new Error(`unknown command: ${command}`);
}
