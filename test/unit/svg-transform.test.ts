import { describe, expect, it } from "vitest";
import {
  applyMatrixToPoint,
  describeAxisAlignedTransform,
  IDENTITY_MATRIX,
  matricesEqual,
  multiplyMatrix,
  parseTransformList,
} from "../../src/importers/svg/transform.js";

function parse(raw: string | undefined) {
  const matrix = parseTransformList(raw);
  if (!matrix) throw new Error(`expected ${raw} to parse`);
  return matrix;
}

function toArray(matrix: { a: number; b: number; c: number; d: number; e: number; f: number }) {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(
    (value) => Math.round(value * 1e6) / 1e6,
  );
}

describe("parseTransformList", () => {
  it("treats missing and empty transforms as the identity", () => {
    expect(toArray(parse(undefined))).toEqual([1, 0, 0, 1, 0, 0]);
    expect(toArray(parse("   "))).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("parses a pure translate", () => {
    expect(toArray(parse("translate(12, 34)"))).toEqual([1, 0, 0, 1, 12, 34]);
    expect(toArray(parse("translate(12)"))).toEqual([1, 0, 0, 1, 12, 0]);
    expect(toArray(parse("translate(-7.5 8)"))).toEqual([1, 0, 0, 1, -7.5, 8]);
  });

  it("parses an Illustrator matrix that is a pure translate", () => {
    // The exact shape Illustrator writes for unscaled text.
    expect(toArray(parse("matrix(1 0 0 1 370.8447 81.8624)"))).toEqual([
      1, 0, 0, 1, 370.8447, 81.8624,
    ]);
  });

  it("parses a matrix carrying a uniform scale", () => {
    const matrix = parse("matrix(2 0 0 2 10 20)");
    expect(toArray(matrix)).toEqual([2, 0, 0, 2, 10, 20]);

    const described = describeAxisAlignedTransform(matrix);
    expect(described).toMatchObject({
      supported: true,
      scaleX: 2,
      scaleY: 2,
      horizontalStretch: 1,
      translateX: 10,
      translateY: 20,
    });
  });

  it("parses a matrix carrying a non-uniform (horizontal) scale", () => {
    // The exact shape Illustrator writes for horizontally scaled text.
    const matrix = parse("matrix(1.0375 0 0 1 370.293 466.0147)");
    expect(toArray(matrix)).toEqual([1.0375, 0, 0, 1, 370.293, 466.0147]);

    const described = describeAxisAlignedTransform(matrix);
    expect(described.supported).toBe(true);
    if (!described.supported) return;
    expect(described.scaleX).toBeCloseTo(1.0375, 10);
    expect(described.scaleY).toBe(1);
    expect(described.horizontalStretch).toBeCloseTo(1.0375, 10);
    expect(described.translateX).toBeCloseTo(370.293, 10);
    expect(described.translateY).toBeCloseTo(466.0147, 10);
  });

  it("composes a multi-function transform list left to right", () => {
    // translate then scale: the scale applies in the translated space, so the
    // translation is NOT scaled.
    expect(toArray(parse("translate(10 20) scale(2)"))).toEqual([2, 0, 0, 2, 10, 20]);
    // scale then translate: the translation IS scaled.
    expect(toArray(parse("scale(2) translate(10 20)"))).toEqual([2, 0, 0, 2, 20, 40]);
    // Commas between functions are legal.
    expect(toArray(parse("translate(5,5), scale(1.5, 3)"))).toEqual([1.5, 0, 0, 3, 5, 5]);
  });

  it("maps points through the composed matrix", () => {
    const matrix = parse("translate(10 20) scale(2 3)");
    expect(applyMatrixToPoint(matrix, 4, 5)).toEqual({ x: 18, y: 35 });
  });

  it("rejects rotation as unrepresentable in flowing HTML text", () => {
    const rotated = parse("rotate(45)");
    expect(rotated.b).toBeGreaterThan(0);
    expect(describeAxisAlignedTransform(rotated)).toEqual({
      supported: false,
      reason: "rotationOrSkew",
    });

    const rotatedMatrix = parse("matrix(0.7071 0.7071 -0.7071 0.7071 100 50)");
    expect(describeAxisAlignedTransform(rotatedMatrix)).toEqual({
      supported: false,
      reason: "rotationOrSkew",
    });
  });

  it("parses rotate about a point and still rejects it", () => {
    const matrix = parse("rotate(-8 42 84)");
    // Rotating about (42, 84) leaves that point fixed.
    const fixed = applyMatrixToPoint(matrix, 42, 84);
    expect(fixed.x).toBeCloseTo(42, 6);
    expect(fixed.y).toBeCloseTo(84, 6);
    expect(describeAxisAlignedTransform(matrix)).toEqual({
      supported: false,
      reason: "rotationOrSkew",
    });
  });

  it("rejects skew", () => {
    expect(describeAxisAlignedTransform(parse("skewX(20)"))).toEqual({
      supported: false,
      reason: "rotationOrSkew",
    });
    expect(describeAxisAlignedTransform(parse("skewY(20)"))).toEqual({
      supported: false,
      reason: "rotationOrSkew",
    });
  });

  it("treats a rotation that cancels itself as supported", () => {
    const matrix = parse("rotate(30) rotate(-30) translate(5 6)");
    expect(matricesEqual(matrix, { ...IDENTITY_MATRIX, e: 5, f: 6 })).toBe(true);
    expect(describeAxisAlignedTransform(matrix).supported).toBe(true);
  });

  it("rejects mirroring, which cannot fold into a font size", () => {
    expect(describeAxisAlignedTransform(parse("matrix(1 0 0 -1 0 100)"))).toEqual({
      supported: false,
      reason: "mirrored",
    });
    expect(describeAxisAlignedTransform(parse("scale(-1 1)"))).toEqual({
      supported: false,
      reason: "mirrored",
    });
  });

  it("returns null for unparseable transform values", () => {
    expect(parseTransformList("wobble(3)")).toBeNull();
    expect(parseTransformList("matrix(1 0 0 1)")).toBeNull();
    expect(parseTransformList("translate(1 2 3)")).toBeNull();
    expect(parseTransformList("translate(10px 4px)")).toBeNull();
    expect(parseTransformList("translate(1 2) garbage translate(3 4)")).toBeNull();
    expect(parseTransformList("not-a-transform")).toBeNull();
  });

  it("multiplies matrices in apply-right-first order", () => {
    const translate = { ...IDENTITY_MATRIX, e: 10, f: 0 };
    const scale = { ...IDENTITY_MATRIX, a: 2, d: 2 };
    expect(toArray(multiplyMatrix(translate, scale))).toEqual([2, 0, 0, 2, 10, 0]);
    expect(toArray(multiplyMatrix(scale, translate))).toEqual([2, 0, 0, 2, 20, 0]);
  });
});
