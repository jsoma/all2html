import type { ArtboardGroup } from "../core/group-artboards.js";
import type { EmitterReadyDocument } from "../ir/types.js";
import {
  createBuiltinEmitters,
  type EmitResult,
  type SharedEmitterDescriptor,
} from "./registry-shared.js";
import { emitStandaloneGroup } from "./standalone.js";
import type { ResolvedEmitterConfig } from "./types.js";

export type { EmitFile, EmitResult } from "./registry-shared.js";
export { formatDictatedExtension } from "./registry-shared.js";

export interface EmitterDescriptor {
  name: string;
  emitAll: (
    doc: EmitterReadyDocument,
    groups: ArtboardGroup[],
    emitterConfig?: ResolvedEmitterConfig,
  ) => EmitResult;
}

const builtinEmitters: Record<string, SharedEmitterDescriptor> =
  createBuiltinEmitters(emitStandaloneGroup);

const emitters = new Map<string, SharedEmitterDescriptor>(Object.entries(builtinEmitters));

export function registerEmitter(emitter: SharedEmitterDescriptor): void {
  if (!emitter.name) {
    throw new Error("Emitter name is required.");
  }
  emitters.set(emitter.name, emitter);
}

export function getEmitter(name: string): EmitterDescriptor {
  const emitter = emitters.get(name);
  if (!emitter) {
    const available = getAvailableFormats().join(", ");
    throw new Error(`Unknown format: "${name}". Available: ${available}`);
  }
  return emitter;
}

export function getAvailableFormats(): string[] {
  return Array.from(emitters.keys()).sort((a, b) => a.localeCompare(b));
}
