import { importSVGFilesFromNode } from "./svg/node.js";
import type { ImporterDescriptor } from "./types.js";

const importers = new Map<string, ImporterDescriptor>();

export function registerImporter(importer: ImporterDescriptor): void {
  if (!importer.name) {
    throw new Error("Importer name is required.");
  }
  importers.set(importer.name, importer);
}

registerImporter({
  name: "svg",
  importFiles: importSVGFilesFromNode,
});

export function getImporter(name: string): ImporterDescriptor {
  const importer = importers.get(name);
  if (!importer) {
    const available = getAvailableImporters().join(", ");
    throw new Error(`Unknown importer: "${name}". Available: ${available}`);
  }
  return importer;
}

export function getAvailableImporters(): string[] {
  return Array.from(importers.keys()).sort((a, b) => a.localeCompare(b));
}
