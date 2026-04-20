import { importSVGFilesFromNode } from "./svg/node.js";
import type { ImporterDescriptor } from "./types.js";

const builtinImporters: Record<string, ImporterDescriptor> = {
  svg: {
    name: "svg",
    importFiles: importSVGFilesFromNode,
  },
};

export function getImporter(name: string): ImporterDescriptor {
  const importer = builtinImporters[name];
  if (!importer) {
    const available = Object.keys(builtinImporters).join(", ");
    throw new Error(`Unknown importer: "${name}". Available: ${available}`);
  }
  return importer;
}

export function getAvailableImporters(): string[] {
  return Object.keys(builtinImporters);
}
