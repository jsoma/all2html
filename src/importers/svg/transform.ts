/**
 * SVG `transform` attribute parsing.
 *
 * Illustrator (and most design-tool SVG exporters) position text with
 * `transform="matrix(a b c d e f)"` rather than `translate(...)`, so the
 * importer has to understand the full transform list, compose it into a single
 * affine matrix, and only then decide whether the result is representable as
 * HTML text.
 */

/** 2D affine transform in SVG `matrix(a b c d e f)` component order. */
export interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Tolerance for treating a matrix component as exactly 0 or 1. */
export const MATRIX_EPSILON = 1e-6;

export const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const NUMBER_PATTERN = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;
const FUNCTION_PATTERN = /([a-zA-Z]+)\s*\(([^)]*)\)/g;

function parseNumbers(raw: string): number[] | null {
  const matches = raw.match(NUMBER_PATTERN);
  if (!matches) return raw.trim() === "" ? [] : null;
  const values = matches.map((part) => Number.parseFloat(part));
  if (values.some((value) => !Number.isFinite(value))) return null;
  // Reject leftovers such as stray identifiers or units ("10px").
  const residue = raw.replace(NUMBER_PATTERN, "").replace(/[\s,]+/g, "");
  if (residue !== "") return null;
  return values;
}

/** Matrix product `left × right` (apply `right` first, then `left`). */
export function multiplyMatrix(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function rotationMatrix(degrees: number): Matrix2D {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

function matrixForFunction(name: string, args: number[]): Matrix2D | null {
  switch (name) {
    case "matrix":
      if (args.length !== 6) return null;
      return { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
    case "translate":
      if (args.length !== 1 && args.length !== 2) return null;
      return { ...IDENTITY_MATRIX, e: args[0], f: args[1] ?? 0 };
    case "scale":
      if (args.length !== 1 && args.length !== 2) return null;
      return { ...IDENTITY_MATRIX, a: args[0], d: args[1] ?? args[0] };
    case "rotate": {
      if (args.length !== 1 && args.length !== 3) return null;
      const rotate = rotationMatrix(args[0]);
      if (args.length === 1) return rotate;
      const [, cx, cy] = args;
      return multiplyMatrix(multiplyMatrix({ ...IDENTITY_MATRIX, e: cx, f: cy }, rotate), {
        ...IDENTITY_MATRIX,
        e: -cx,
        f: -cy,
      });
    }
    case "skewX":
      if (args.length !== 1) return null;
      return { ...IDENTITY_MATRIX, c: Math.tan((args[0] * Math.PI) / 180) };
    case "skewY":
      if (args.length !== 1) return null;
      return { ...IDENTITY_MATRIX, b: Math.tan((args[0] * Math.PI) / 180) };
    default:
      return null;
  }
}

/**
 * Parse a full SVG transform list into one composed matrix.
 *
 * Returns `null` when the value cannot be parsed (unknown function, bad arity,
 * junk between functions). An empty/absent value composes to the identity.
 */
export function parseTransformList(raw: string | undefined | null): Matrix2D | null {
  if (raw == null) return { ...IDENTITY_MATRIX };
  const trimmed = raw.trim();
  if (trimmed === "") return { ...IDENTITY_MATRIX };

  let composed: Matrix2D = { ...IDENTITY_MATRIX };
  let cursor = 0;
  let matched = false;

  FUNCTION_PATTERN.lastIndex = 0;
  let match = FUNCTION_PATTERN.exec(trimmed);
  while (match !== null) {
    // Anything other than whitespace/commas between functions is invalid.
    if (trimmed.slice(cursor, match.index).trim().replace(/,/g, "") !== "") return null;
    const args = parseNumbers(match[2]);
    if (!args) return null;
    const next = matrixForFunction(match[1], args);
    if (!next) return null;
    composed = multiplyMatrix(composed, next);
    cursor = match.index + match[0].length;
    matched = true;
    match = FUNCTION_PATTERN.exec(trimmed);
  }

  if (!matched) return null;
  if (trimmed.slice(cursor).trim().replace(/,/g, "") !== "") return null;
  return composed;
}

/** Map a point through a matrix. */
export function applyMatrixToPoint(
  matrix: Matrix2D,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

export function matricesEqual(left: Matrix2D, right: Matrix2D): boolean {
  return (
    Math.abs(left.a - right.a) <= MATRIX_EPSILON &&
    Math.abs(left.b - right.b) <= MATRIX_EPSILON &&
    Math.abs(left.c - right.c) <= MATRIX_EPSILON &&
    Math.abs(left.d - right.d) <= MATRIX_EPSILON &&
    Math.abs(left.e - right.e) <= MATRIX_EPSILON &&
    Math.abs(left.f - right.f) <= MATRIX_EPSILON
  );
}

export type MatrixRejectionReason = "unparsed" | "rotationOrSkew" | "mirrored";

export type AxisAlignedTransform =
  | {
      supported: true;
      /** Horizontal scale factor (matrix `a`). Always > 0. */
      scaleX: number;
      /** Vertical scale factor (matrix `d`). Always > 0. */
      scaleY: number;
      /** Horizontal stretch relative to the vertical scale (`a / d`). */
      horizontalStretch: number;
      translateX: number;
      translateY: number;
    }
  | { supported: false; reason: Exclude<MatrixRejectionReason, "unparsed"> };

/**
 * Describe a matrix as a translation plus axis-aligned scale.
 *
 * Rotation and skew (`b`/`c` non-zero) cannot be represented as flowing HTML
 * text, and neither can mirroring (a negative scale factor), so both are
 * reported as unsupported with distinct reasons.
 */
export function describeAxisAlignedTransform(matrix: Matrix2D): AxisAlignedTransform {
  if (Math.abs(matrix.b) > MATRIX_EPSILON || Math.abs(matrix.c) > MATRIX_EPSILON) {
    return { supported: false, reason: "rotationOrSkew" };
  }
  if (matrix.a <= MATRIX_EPSILON || matrix.d <= MATRIX_EPSILON) {
    return { supported: false, reason: "mirrored" };
  }
  return {
    supported: true,
    scaleX: matrix.a,
    scaleY: matrix.d,
    horizontalStretch: matrix.a / matrix.d,
    translateX: matrix.e,
    translateY: matrix.f,
  };
}

/** True when the value is close enough to 1 to ignore. */
export function isUnitScale(value: number): boolean {
  return Math.abs(value - 1) <= MATRIX_EPSILON;
}
