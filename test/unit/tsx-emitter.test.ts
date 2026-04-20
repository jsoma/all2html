import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitReact } from "../../src/emitters/react.js";

function loadAndProcess(fixtureName: string) {
  const ir = JSON.parse(readFileSync(`test/fixtures/ir/${fixtureName}`, "utf-8"));
  return processDocument(ir);
}

describe("TSX emitter", () => {
  const { document: doc } = loadAndProcess("single-artboard-basic.json");

  it("generates plain JSX by default", () => {
    const { jsx } = emitReact(doc);
    expect(jsx).toContain('import React, { useMemo } from "react"');
    expect(jsx).not.toContain("interface");
    expect(jsx).not.toContain(": JSX.Element");
  });

  it("generates TSX with Props interface when typescript: true", () => {
    const { jsx } = emitReact(doc, undefined, { typescript: true });
    expect(jsx).toContain("interface");
    expect(jsx).toContain("Props");
    expect(jsx).toContain("assetsPath?: string");
    expect(jsx).toContain("className?: string");
  });

  it("types the component function return type", () => {
    const { jsx } = emitReact(doc, undefined, { typescript: true });
    expect(jsx).toContain(": JSX.Element");
  });

  it("imports JSX type instead of React default import", () => {
    const { jsx } = emitReact(doc, undefined, { typescript: true });
    expect(jsx).toContain('import type { JSX } from "react"');
    expect(jsx).toContain('import { useMemo } from "react"');
    expect(jsx).not.toContain("import React");
  });

  it("generates valid component name from slug", () => {
    const { jsx } = emitReact(doc, undefined, { typescript: true });
    // slug is "test-graphic" → "TestGraphic"
    expect(jsx).toMatch(/function \w+\(/);
    expect(jsx).toMatch(/interface \w+Props/);
  });

  it("still renders functional component output", () => {
    const { jsx } = emitReact(doc, undefined, { typescript: true });
    expect(jsx).toContain("dangerouslySetInnerHTML");
    expect(jsx).toContain("useMemo");
    expect(jsx).toContain("export default function");
  });
});
