import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IRValidationError, loadAndValidateIR } from "../../src/ir/validate.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

describe("loadAndValidateIR", () => {
  it("accepts a valid single-artboard document", () => {
    const doc = loadAndValidateIR(loadFixture("single-artboard-basic.json"));
    expect(doc.artboards).toHaveLength(1);
    expect(doc.artboards[0].name).toBe("desktop");
    expect(doc.metadata.slug).toBe("test-graphic");
  });

  it("accepts a valid multi-artboard document", () => {
    const doc = loadAndValidateIR(loadFixture("multi-artboard-responsive.json"));
    expect(doc.artboards).toHaveLength(3);
  });

  it("rejects empty object", () => {
    expect(() => loadAndValidateIR({})).toThrow(IRValidationError);
  });

  it("rejects document with no artboards", () => {
    const invalid = loadFixture("single-artboard-basic.json");
    invalid.artboards = [];
    expect(() => loadAndValidateIR(invalid)).toThrow(IRValidationError);
  });

  it("rejects document with invalid text element", () => {
    const invalid = loadFixture("single-artboard-basic.json");
    invalid.artboards[0].layers[0].elements[0].paragraphs = [];
    expect(() => loadAndValidateIR(invalid)).toThrow(IRValidationError);
  });

  it("rejects document with missing slug", () => {
    const invalid = loadFixture("single-artboard-basic.json");
    invalid.metadata.slug = "";
    expect(() => loadAndValidateIR(invalid)).toThrow(IRValidationError);
  });

  it("accepts arbitrary metadata fields as passthrough", () => {
    const input = loadFixture("single-artboard-basic.json");
    input.metadata.headline = "My Big Story";
    input.metadata.credit = "Graphics Dept";
    input.metadata.customField = "custom-value";
    input.metadata.nested = { foo: [1, 2, 3], bar: true };

    const doc = loadAndValidateIR(input);
    expect(doc.metadata.headline).toBe("My Big Story");
    expect(doc.metadata.credit).toBe("Graphics Dept");
    expect(doc.metadata.customField).toBe("custom-value");
    expect(doc.metadata.nested).toEqual({ foo: [1, 2, 3], bar: true });
  });

  it("rejects non-JSON-serializable metadata values", () => {
    const input = loadFixture("single-artboard-basic.json");
    // Zod catchall rejects values that aren't valid JSON types
    input.metadata.bad = undefined;
    expect(() => loadAndValidateIR(input)).toThrow(IRValidationError);
  });
});
