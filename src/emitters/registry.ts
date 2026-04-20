import type { ArtboardGroup } from "../core/group-artboards.js";
import type { EmitterReadyDocument } from "../ir/types.js";
import {
  createBuiltinEmitters,
  type EmitFile,
  type EmitResult,
  type SharedEmitterDescriptor,
} from "./registry-shared.js";
import { emitStandalone } from "./standalone.js";
import type { EmitterConfig } from "./types.js";

export type { EmitFile, EmitResult } from "./registry-shared.js";

export interface EmitterDescriptor {
  name: string;
  emitAll: (
    doc: EmitterReadyDocument,
    groups: ArtboardGroup[],
    emitterConfig?: EmitterConfig,
  ) => EmitResult;
}

const builtinEmitters: Record<string, SharedEmitterDescriptor> =
  createBuiltinEmitters(emitStandalone);

export function getEmitter(name: string): EmitterDescriptor {
  const emitter = builtinEmitters[name];
  if (!emitter) {
    const available = Object.keys(builtinEmitters).join(", ");
    throw new Error(`Unknown format: "${name}". Available: ${available}`);
  }
  return emitter;
}

export function getAvailableFormats(): string[] {
  return Object.keys(builtinEmitters);
}
