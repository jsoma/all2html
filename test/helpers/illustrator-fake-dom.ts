/**
 * An executable harness for `plugins/illustrator/exporter.jsx`.
 *
 * Every other Illustrator test extracts one *named function* out of the file with
 * `new Function(...)` and then writes its own call to it. That proves the function
 * body and never proves `runExporter()` still calls it — four separate guards
 * (the output-directory constructor, the canonical settings sanitizer, the
 * multiple-files write loop, and the slug keyword-casing) could each be deleted
 * with the entire suite green.
 *
 * So this evaluates the **whole shipped file**, including its last line
 * (`$.global.__ALL2HTML_RESULT__ = executeAll2Html();`), against a fake Illustrator
 * DOM. `runExporter` runs end to end: settings precedence, artboard/layer/text
 * extraction, image export, ir.json persistence, the core call, and every write.
 * What a test asserts here is a *call site*, not a function body.
 *
 * `All2Html` is wired to the TypeScript core rather than to the built ES5 bundle.
 * The bundle being byte-current and ES3-clean is already pinned by
 * `test/integration/extendscript-bundle.test.ts` and `es5-runtime-apis.test.ts`,
 * and the bundle's own `processAndEmit` is exercised through
 * `test/integration/surface-entrypoints.test.ts`; what is unpinned — and what this
 * covers — is the exporter's orchestration around it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { relativeOutputDirectory } from "../../src/core/artifact-path.js";
import { processAndEmit } from "../../src/extendscript/index.js";
import { defaultSettings } from "../../src/ir/defaults.js";
import { isValidSettingValue } from "../../src/ir/settings-definitions.js";

const exporterPath = resolve(import.meta.dirname, "../../plugins/illustrator/exporter.jsx");
const exporterSource = readFileSync(exporterPath, "utf-8");

/** AI rectangle: [left, top, right, bottom], with top > bottom (Y is up). */
export type AiRect = [number, number, number, number];

export interface FakeArtboardSpec {
  name: string;
  /** Defaults to a 600x400 box laid out left-to-right, one artboard per column. */
  rect?: AiRect;
}

export interface FakeLayerSpec {
  name: string;
  visible?: boolean;
  opacity?: number;
  locked?: boolean;
}

export interface FakeTextFrameSpec {
  contents: string;
  /** Layer name this frame lives on. Defaults to the first layer. */
  layer?: string;
  name?: string;
  /** Defaults to a small box inside the first artboard. */
  bounds?: AiRect;
  kind?: "point" | "area";
  hidden?: boolean;
}

export interface FakeDocumentSpec {
  /** File name including the extension; the slug fallback strips `.ai`. */
  name?: string;
  /** Directory containing the .ai file, without a trailing slash. */
  path?: string;
  saved?: boolean;
  artboards?: FakeArtboardSpec[];
  layers?: FakeLayerSpec[];
  textFrames?: FakeTextFrameSpec[];
  /** Rendered into an `ai2html-settings` text block placed off-artboard. */
  settingsBlock?: Record<string, string>;
  /** Written to `<path>/all2html.config.json` before the run. */
  configFile?: Record<string, unknown>;
  /** Delivered the way the CEP panel delivers it: a temp file the exporter reads. */
  panelSettings?: Record<string, unknown>;
}

export interface RecordedExport {
  path: string;
  type: string;
  options: Record<string, unknown>;
}

export interface ExporterRunResult {
  /** The automated JSON envelope `executeAll2Html()` stores on `$.global`. */
  envelope: {
    success: boolean;
    error?: string;
    outputPath?: string;
    slug?: string;
    artboardCount?: number;
    imageCount?: number;
    warnings: Record<string, string[]>;
    structuredWarnings: { code: string; category: string; message: string }[];
  };
  /** Every text file written through `writeFile()`, keyed by absolute path. */
  writes: Map<string, string>;
  /** Every `doc.exportFile()` call, in order. */
  exports: RecordedExport[];
  /** Every folder `ensureFolder()` created. */
  folders: string[];
  /** Parsed `ir.json`, when one was written. */
  irDocument: Record<string, unknown> | undefined;
}

function settingsBlockContents(settings: Record<string, string>): string {
  const lines = ["ai2html-settings"];
  for (const [key, value] of Object.entries(settings)) lines.push(`${key}: ${value}`);
  return lines.join("\n");
}

/**
 * The exporter reads these objects structurally — whatever property it happens to
 * touch, in whatever order — so there is no useful static type for a stub of the
 * Illustrator DOM. The shape is pinned by the exporter running against it.
 */
// biome-ignore lint/suspicious/noExplicitAny: a host-DOM stub has no meaningful static type.
type AiObject = any;

/** Illustrator collections are indexable, have `length`, and answer `getByName`. */
function collection<T>(items: T[]): T[] & { getByName(name: string): T } {
  const list = items as T[] & { getByName(name: string): T };
  list.getByName = (name: string) => {
    for (const item of items) {
      if ((item as { name?: string }).name === name) return item;
    }
    throw new Error(`No element named ${name}`);
  };
  return list;
}

function makeCharacters(text: string): AiObject[] {
  const attributes = {
    textFont: { name: "ArialMT" },
    size: 14,
    fillColor: { typename: "RGBColor", red: 0, green: 0, blue: 0 },
    tracking: 0,
    capitalization: "FontCapsOption.NORMALCAPS",
    baselinePosition: "FontBaselineOption.NORMAL",
    leading: 18,
  };
  return text.split("").map(() => ({ characterAttributes: attributes }));
}

function makeParagraphs(contents: string): AiObject[] {
  return contents.split(/\r\n|\r|\n/).map((line) => ({
    contents: line,
    justification: "Justification.LEFT",
    spaceBefore: 0,
    spaceAfter: 0,
    characters: collection(makeCharacters(line)),
  }));
}

export function runIllustratorExporter(spec: FakeDocumentSpec = {}): ExporterRunResult {
  const docPath = spec.path ?? "/docs";
  const docName = spec.name ?? "chart.ai";

  // ---- in-memory filesystem -------------------------------------------------
  const files = new Map<string, string>();
  const writes = new Map<string, string>();
  const exports: RecordedExport[] = [];
  const folders: string[] = [];

  if (spec.configFile) {
    files.set(`${docPath}/all2html.config.json`, JSON.stringify(spec.configFile));
  }
  const panelSettingsPath = `${docPath}/.panel-settings.json`;
  if (spec.panelSettings) files.set(panelSettingsPath, JSON.stringify(spec.panelSettings));

  class FakeFile {
    path: string;
    encoding = "UTF-8";
    lineFeed = "Unix";
    private mode: string | undefined;
    private buffer = "";

    constructor(path: string) {
      this.path = String(path);
    }
    get name(): string {
      return this.path.slice(this.path.lastIndexOf("/") + 1);
    }
    get exists(): boolean {
      return files.has(this.path);
    }
    open(mode: string): boolean {
      this.mode = mode;
      this.buffer = "";
      return true;
    }
    read(): string {
      return files.get(this.path) ?? "";
    }
    write(content: string): boolean {
      this.buffer += content;
      return true;
    }
    close(): boolean {
      if (this.mode === "w") {
        files.set(this.path, this.buffer);
        writes.set(this.path, this.buffer);
      }
      this.mode = undefined;
      return true;
    }
    remove(): boolean {
      files.delete(this.path);
      return true;
    }
  }

  class FakeFolder {
    path: string;
    constructor(path: string) {
      this.path = String(path);
    }
    get exists(): boolean {
      return folders.indexOf(this.path) >= 0;
    }
    create(): boolean {
      folders.push(this.path);
      return true;
    }
    getFiles(): unknown[] {
      return [];
    }
  }

  // ---- document -------------------------------------------------------------
  const artboardSpecs = spec.artboards ?? [{ name: "chart" }];
  const layerSpecs = spec.layers ?? [{ name: "Layer 1" }];

  const docStub: AiObject = { typename: "Document" };

  const layers = layerSpecs.map((layer) => ({
    typename: "Layer",
    name: layer.name,
    visible: layer.visible ?? true,
    locked: layer.locked ?? false,
    hidden: false,
    opacity: layer.opacity ?? 100,
    parent: docStub,
    pathItems: collection<AiObject>([]),
    pageItems: collection<AiObject>([]),
    groupItems: collection<AiObject>([]),
    layers: collection<AiObject>([]),
    textFrames: collection<AiObject>([]),
  }));

  const artboards = artboardSpecs.map((artboard, index) => ({
    name: artboard.name,
    artboardRect: artboard.rect ?? ([index * 700, 0, index * 700 + 600, -400] as AiRect),
  }));

  const textFrameSpecs = [...(spec.textFrames ?? [])];
  if (spec.settingsBlock) {
    textFrameSpecs.push({
      contents: settingsBlockContents(spec.settingsBlock),
      // Off every artboard, so the exporter does not hide it mid-run.
      bounds: [-5000, 5000, -4800, 4900],
    });
  }

  const textFrames = textFrameSpecs.map((frame, index) => {
    const layer = layers.find((candidate) => candidate.name === frame.layer) ?? layers[0];
    const bounds = frame.bounds ?? ([10, -10 - index * 40, 210, -40 - index * 40] as AiRect);
    const contents = frame.contents;
    const tf: AiObject = {
      typename: "TextFrame",
      name: frame.name ?? "",
      note: "",
      contents,
      kind: frame.kind === "area" ? "TextType.AREATEXT" : "TextType.POINTTEXT",
      hidden: frame.hidden ?? false,
      locked: false,
      opacity: 100,
      parent: layer,
      layer,
      visibleBounds: bounds,
      left: bounds[0],
      top: bounds[1],
      width: bounds[2] - bounds[0],
      height: bounds[1] - bounds[3],
      lines: collection(contents.split(/\r\n|\r|\n/).map((line) => ({ contents: line }))),
      characters: collection(makeCharacters(contents)),
      paragraphs: collection(makeParagraphs(contents)),
    };
    layer.textFrames.push(tf);
    return tf;
  });

  const doc: AiObject = {
    typename: "Document",
    name: docName,
    path: docPath,
    fullName: `${docPath}/${docName}`,
    saved: spec.saved ?? true,
    documentColorSpace: "DocumentColorSpace.RGB",
    activeLayer: { name: layers[0]?.name ?? "Layer 1" },
    layers: collection(layers),
    textFrames: collection(textFrames),
    placedItems: collection<AiObject>([]),
    rasterItems: collection<AiObject>([]),
    artboards: Object.assign(collection(artboards), {
      setActiveArtboardIndex(): void {},
    }),
    exportFile(file: FakeFile, type: string, options: Record<string, unknown>): void {
      exports.push({ path: file.path, type: String(type), options: { ...options } });
      // Illustrator appends the extension; the SVG path is the only one the
      // exporter reads back, and only when the layer is tagged inline.
      if (String(type) === "ExportType.SVG") files.set(file.path, "<svg><g/></svg>");
    },
  };
  Object.assign(docStub, { typename: "Document" });

  // ---- Illustrator globals --------------------------------------------------
  const app = {
    version: "28.0.0",
    userInteractionLevel: "UserInteractionLevel.DISPLAYALERTS",
    documents: collection<AiObject>([doc]),
    activeDocument: doc,
  };

  const globalScope: Record<string, unknown> = { ALL2HTML_AUTOMATED: true };
  if (spec.panelSettings) globalScope.__ALL2HTML_PANEL_SETTINGS_PATH__ = panelSettingsPath;
  const dollar = { global: globalScope, writeln(): void {} };

  const constant = (name: string) =>
    new Proxy({} as Record<string, string>, {
      get: (_target, key) => `${name}.${String(key)}`,
    });

  const optionsClass = () =>
    function FakeOptions(this: Record<string, unknown>) {
      /* every property is assigned by the exporter */
    } as unknown as new () => Record<string, unknown>;

  const All2Html = {
    processAndEmit,
    relativeOutputDirectory,
    isValidSettingValue,
    defaultSettings,
  };

  const run = new Function(
    "app",
    "File",
    "Folder",
    "ExportType",
    "ExportOptionsJPEG",
    "ExportOptionsPNG8",
    "ExportOptionsSVG",
    "SVGFontSubsetting",
    "SVGDTDVersion",
    "SVGCSSPropertyLocation",
    "DocumentColorSpace",
    "TextType",
    "BlendModes",
    "FontBaselineOption",
    "FontCapsOption",
    "Justification",
    "UserInteractionLevel",
    "All2Html",
    "alert",
    "$",
    `${exporterSource}\nreturn $.global.__ALL2HTML_RESULT__;`,
  ) as (...args: unknown[]) => string;

  const raw = run(
    app,
    FakeFile,
    FakeFolder,
    constant("ExportType"),
    optionsClass(),
    optionsClass(),
    optionsClass(),
    constant("SVGFontSubsetting"),
    constant("SVGDTDVersion"),
    constant("SVGCSSPropertyLocation"),
    constant("DocumentColorSpace"),
    constant("TextType"),
    constant("BlendModes"),
    constant("FontBaselineOption"),
    constant("FontCapsOption"),
    constant("Justification"),
    constant("UserInteractionLevel"),
    All2Html,
    () => {
      throw new Error("alert() must not run in automated mode");
    },
    dollar,
  );

  const envelope = JSON.parse(raw) as ExporterRunResult["envelope"];
  const irPath = `${envelope.outputPath ?? ""}ir.json`;
  const irRaw = writes.get(irPath);

  return {
    envelope,
    writes,
    exports,
    folders,
    irDocument: irRaw ? (JSON.parse(irRaw) as Record<string, unknown>) : undefined,
  };
}

/** Every emitted HTML file, keyed by basename. */
export function emittedHtml(run: ExporterRunResult): Map<string, string> {
  const html = new Map<string, string>();
  for (const [path, content] of run.writes) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name !== "ir.json") html.set(name, content);
  }
  return html;
}
