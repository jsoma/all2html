import type { ZodError } from "zod";
import { DocumentSchema } from "./schema.js";
import type { Document } from "./types.js";

export class IRValidationError extends Error {
  public readonly issues: { path: string; message: string }[];

  constructor(zodError: ZodError) {
    const issues = zodError.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    const summary = issues
      .slice(0, 5)
      .map((i) => `  ${i.path}: ${i.message}`)
      .join("\n");
    const more = issues.length > 5 ? `\n  ...and ${issues.length - 5} more` : "";
    super(`Invalid IR document:\n${summary}${more}`);
    this.name = "IRValidationError";
    this.issues = issues;
  }
}

export function loadAndValidateIR(json: unknown): Document {
  const result = DocumentSchema.safeParse(json);
  if (!result.success) {
    throw new IRValidationError(result.error);
  }
  return result.data as Document;
}
