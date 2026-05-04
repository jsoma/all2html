interface HostDocument {
  XMPString: string;
  name: string;
  path: { fsName: string };
  saved: boolean;
  artboards: unknown[];
  textFrames: TextFrame[];
}

interface RenderQueueItem {
  outputModule(index: number): { templates?: string[] };
  remove(): void;
}

interface HostProject {
  activeItem?: unknown;
  file?: File;
  numItems: number;
  renderQueue: {
    canQueueInAME?: boolean;
    items: { add(comp: CompItem): RenderQueueItem };
  };
  item(index: number): unknown;
}

interface HostApp {
  name?: string;
  activeDocument: HostDocument;
  project: HostProject;
}

declare const app: HostApp;
declare const $: {
  [key: string]: unknown;
  global: Record<string, unknown>;
  evalFile(file: File): void;
  fileName: string;
};

declare const ExternalObject: {
  new (library: string): unknown;
  AdobeXMPScript?: unknown;
};

declare class File {
  constructor(path: string);
  readonly name: string;
  readonly exists: boolean;
  readonly fsName: string;
  readonly fullName: string;
  readonly parent: Folder;
  encoding: string;
  open(mode: string): boolean;
  read(): string;
  write(content: string): boolean;
  close(): boolean;
  remove(): boolean;
}

declare class Folder {
  constructor(path: string);
  static readonly temp: Folder;
  readonly exists: boolean;
  readonly fsName: string;
  readonly fullName: string;
  execute(): boolean;
}

declare class Layer {
  readonly matchName: string;
  readonly inPoint: number;
  property(name: string): AeProperty;
}

interface AeProperty {
  property(name: string): AeProperty;
  valueAtTime(time: number, preExpression: boolean): { font?: string };
}

declare class CompItem {
  readonly id?: number | string;
  readonly index: number;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly frameRate: number;
  readonly numLayers: number;
  readonly displayStartTime: number;
  layer(index: number): Layer;
}

declare class TextFrame {
  readonly contents: string;
  readonly characters: Array<{
    characterAttributes: { textFont: { name: string } };
  }>;
  readonly lines: Array<{ contents: string }>;
}

declare class XMPMeta {
  constructor(xmp: string);
  static registerNamespace(namespace: string, prefix: string): void;
  doesPropertyExist(namespace: string, key: string): boolean;
  getProperty(namespace: string, key: string): { value: string };
  setProperty(namespace: string, key: string, value: string): void;
  deleteProperty(namespace: string, key: string): void;
  serialize(): string;
}
