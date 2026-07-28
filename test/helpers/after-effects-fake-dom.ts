/**
 * An executable harness for `plugins/after-effects/exporter.jsx`, modeled on
 * `illustrator-fake-dom.ts`: it evaluates the **whole shipped file** against a
 * fake After Effects DOM, so what a test asserts is a call site inside
 * `exportActiveComp()` — comp targeting, render-queue orchestration, the
 * status computation, and every file write — not an extracted function body.
 *
 * `All2HtmlAE` is wired to the TypeScript helper entry (`src/extendscript/
 * ae-index.ts`) rather than the built ES5 bundle; the bundle itself is pinned
 * by `test/integration/after-effects-shared-helpers.test.ts`.
 *
 * The render queue is where the status contract lives, so it is modeled
 * honestly: `renderQueue.render()` writes the output file of every enabled
 * queue item **only when the spec allows it** (`renderWritesVideo` /
 * `renderWritesPoster`), which is what lets a test distinguish "render() ran"
 * from "the expected file exists" — the exact gap the old `success: true`
 * paper-covered.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  escapeAttr,
  escapeHtml,
  escapeInlineJson,
  googleFontsLinkTags,
  googleFontsUrl,
} from "../../src/extendscript/ae-index.js";

const exporterPath = resolve(import.meta.dirname, "../../plugins/after-effects/exporter.jsx");
const exporterSource = readFileSync(exporterPath, "utf-8");
const playerTemplate = readFileSync(
  resolve(import.meta.dirname, "../../plugins/after-effects/player-template.html"),
  "utf-8",
);

export interface FakeCompSpec {
  id: string;
  name: string;
  width?: number;
  height?: number;
  duration?: number;
  frameRate?: number;
}

export interface FakeAeProjectSpec {
  /** Comps in the project, in item order. */
  comps?: FakeCompSpec[];
  /** id of the active comp, or null for no active comp. Defaults to the first comp. */
  activeCompId?: string | null;
  /** Output-module templates the render queue offers. */
  outputTemplates?: string[];
  canQueueInAME?: boolean;
  /** Whether renderQueue.render() actually writes a .mp4 output file. */
  renderWritesVideo?: boolean;
  /** Whether renderQueue.render() actually writes a poster (.png) output file. */
  renderWritesPoster?: boolean;
  /** Delivered the way the CEP panel delivers it: inline JSON on $.global. */
  panelSettings?: Record<string, unknown>;
  /** Written to <projectFolder>/all2html-ae.config.json before the run. */
  configFile?: Record<string, unknown>;
}

export interface AeExporterRunResult {
  /** The automated JSON envelope the exporter stores on $.global. */
  envelope: {
    status: "complete" | "queued" | "failed";
    error?: string | null;
    outputPath?: string;
    slug?: string;
    overlayCount?: number;
    compName?: string;
    video?: {
      mode?: string;
      template?: string | null;
      path?: string | null;
      error?: string | null;
    };
    poster?: {
      requested?: boolean;
      template?: string | null;
      path?: string | null;
      name?: string | null;
      error?: string | null;
    };
    warnings?: string[];
    summaryPath?: string;
    htmlPath?: string;
    jsonPath?: string;
  };
  /** Whether exportActiveComp() threw (the automated envelope still records why). */
  threw: boolean;
  thrownMessage: string | undefined;
  /** Every file in the in-memory filesystem, keyed by absolute path. */
  files: Map<string, string>;
  /** Every queueInAME() call. */
  ameQueueCalls: number;
  /** Every renderQueue.render() call. */
  renderCalls: number;
}

const PROJECT_FOLDER = "/proj";

// biome-ignore lint/suspicious/noExplicitAny: a host-DOM stub has no meaningful static type.
type AeObject = any;

export function runAfterEffectsExporter(spec: FakeAeProjectSpec = {}): AeExporterRunResult {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  let ameQueueCalls = 0;
  let renderCalls = 0;

  const outputTemplates = spec.outputTemplates ?? [];
  const renderWritesVideo = spec.renderWritesVideo ?? true;
  const renderWritesPoster = spec.renderWritesPoster ?? true;

  if (spec.configFile) {
    files.set(`${PROJECT_FOLDER}/all2html-ae.config.json`, JSON.stringify(spec.configFile));
  }

  function normalizeDir(path: string): string {
    const value = String(path);
    return value.length > 1 ? value.replace(/\/+$/, "") : value;
  }

  function dirname(path: string): string {
    return path.slice(0, path.lastIndexOf("/")) || "/";
  }

  class FakeFolder {
    path: string;
    constructor(path: string) {
      this.path = normalizeDir(path);
    }
    get exists(): boolean {
      return folders.has(this.path);
    }
    get fsName(): string {
      return this.path;
    }
    create(): boolean {
      folders.add(this.path);
      return true;
    }
    getFiles(): AeObject[] {
      const entries: AeObject[] = [];
      for (const filePath of files.keys()) {
        if (dirname(filePath) === this.path) entries.push(new FakeFile(filePath));
      }
      return entries;
    }
  }

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
    get fsName(): string {
      return this.path;
    }
    get exists(): boolean {
      return files.has(this.path);
    }
    get parent(): FakeFolder {
      return new FakeFolder(dirname(this.path));
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
      if (this.mode === "w") files.set(this.path, this.buffer);
      this.mode = undefined;
      return true;
    }
    remove(): boolean {
      files.delete(this.path);
      return true;
    }
  }

  class FakeOutputModule {
    templates: string[] = outputTemplates.slice();
    file: FakeFile | null = null;
    appliedTemplate: string | null = null;
    applyTemplate(name: string): void {
      this.appliedTemplate = String(name);
    }
  }

  class FakeCompItem {
    id: string;
    name: string;
    width: number;
    height: number;
    duration: number;
    frameRate: number;
    frameDuration: number;
    displayStartTime = 0;
    numLayers = 0;
    removed = false;

    constructor(compSpec: FakeCompSpec) {
      this.id = compSpec.id;
      this.name = compSpec.name;
      this.width = compSpec.width ?? 600;
      this.height = compSpec.height ?? 400;
      this.duration = compSpec.duration ?? 2;
      this.frameRate = compSpec.frameRate ?? 30;
      this.frameDuration = 1 / this.frameRate;
    }
    layer(): AeObject {
      throw new Error("no layers in this fake comp");
    }
    duplicate(): FakeCompItem {
      return new FakeCompItem({ id: `${this.id}__dup`, name: this.name });
    }
    remove(): void {
      this.removed = true;
    }
  }

  class FakeRenderQueueItem {
    comp: FakeCompItem;
    render = false;
    removed = false;
    timeSpanStart = 0;
    timeSpanDuration = 0;
    private module = new FakeOutputModule();

    constructor(comp: FakeCompItem) {
      this.comp = comp;
    }
    outputModule(): FakeOutputModule {
      return this.module;
    }
    remove(): void {
      this.removed = true;
    }
  }

  const queueItems: FakeRenderQueueItem[] = [];

  const renderQueue: AeObject = {
    canQueueInAME: spec.canQueueInAME ?? false,
    get numItems(): number {
      return queueItems.length;
    },
    item(index: number): FakeRenderQueueItem {
      return queueItems[index - 1];
    },
    items: {
      add(comp: FakeCompItem): FakeRenderQueueItem {
        const item = new FakeRenderQueueItem(comp);
        queueItems.push(item);
        return item;
      },
    },
    render(): void {
      renderCalls += 1;
      for (const item of queueItems) {
        if (!item.render || item.removed) continue;
        const outputFile = item.outputModule().file;
        if (!outputFile) continue;
        const isPoster = /\.(png|jpe?g)$/i.test(outputFile.path);
        if (isPoster ? renderWritesPoster : renderWritesVideo) {
          files.set(outputFile.path, "binary");
        }
      }
    },
    queueInAME(): void {
      ameQueueCalls += 1;
    },
  };

  const compSpecs = spec.comps ?? [{ id: "1", name: "Main Comp" }];
  const comps = compSpecs.map((compSpec) => new FakeCompItem(compSpec));
  const activeCompId = spec.activeCompId === undefined ? compSpecs[0]?.id : spec.activeCompId;
  const activeComp = comps.find((comp) => comp.id === activeCompId) ?? null;

  const app: AeObject = {
    beginUndoGroup(): void {},
    endUndoGroup(): void {},
    project: {
      file: { parent: { fsName: PROJECT_FOLDER }, name: "project.aep" },
      numItems: comps.length,
      item(index: number): FakeCompItem {
        return comps[index - 1];
      },
      activeItem: activeComp,
      renderQueue,
    },
  };

  const globalScope: Record<string, unknown> = {
    ALL2HTML_AUTOMATED: true,
    __ALL2HTML_AE_PLAYER_TEMPLATE__: playerTemplate,
  };
  if (spec.panelSettings) {
    globalScope.__ALL2HTML_AE_PANEL_SETTINGS__ = JSON.stringify(spec.panelSettings);
  }
  const dollar = {
    global: globalScope,
    fileName: "/repo/plugins/after-effects/exporter.jsx",
    evalFile(): void {
      throw new Error("$.evalFile must not run in the fake AE harness");
    },
  };

  const All2HtmlAE = {
    escapeAttr,
    escapeHtml,
    escapeInlineJson,
    googleFontsUrl,
    googleFontsLinkTags,
  };

  const run = new Function(
    "app",
    "File",
    "Folder",
    "CompItem",
    "ParagraphJustification",
    "All2HtmlAE",
    "$",
    exporterSource,
  ) as (...args: unknown[]) => void;

  let threw = false;
  let thrownMessage: string | undefined;
  try {
    run(app, FakeFile, FakeFolder, FakeCompItem, {}, All2HtmlAE, dollar);
  } catch (error) {
    threw = true;
    thrownMessage = error instanceof Error ? error.message : String(error);
  }

  const raw = globalScope.__ALL2HTML_RESULT__;
  if (typeof raw !== "string") {
    throw new Error(
      `exporter stored no automated result (threw: ${threw}${thrownMessage ? `, ${thrownMessage}` : ""})`,
    );
  }
  const envelope = JSON.parse(raw) as AeExporterRunResult["envelope"];

  return { envelope, threw, thrownMessage, files, ameQueueCalls, renderCalls };
}

/** Parsed <slug>-summary.json, when the run wrote one. */
export function writtenSummary(result: AeExporterRunResult): Record<string, unknown> | undefined {
  for (const [path, content] of result.files) {
    if (path.endsWith("-summary.json")) return JSON.parse(content) as Record<string, unknown>;
  }
  return undefined;
}
