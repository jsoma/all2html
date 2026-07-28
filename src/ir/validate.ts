import type { ZodError } from "zod";
import { DocumentSchema } from "./schema.js";
import type { Document } from "./types.js";

export interface IRValidationIssue {
  path: string;
  message: string;
}

export class IRValidationError extends Error {
  public readonly issues: IRValidationIssue[];

  constructor(source: ZodError | IRValidationIssue[]) {
    const issues = Array.isArray(source)
      ? source
      : source.issues.map((issue) => ({
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

/**
 * Pre-parse guard for the one key Zod cannot report on: the installed Zod's
 * record parser silently *drops* an own `__proto__` key while validating
 * `Document.assets` — the key is an own property after `JSON.parse` and absent
 * after `.parse()`, with no error — so the `key === asset.id` refine passes
 * vacuously and the document validates with an asset missing. Rejecting it here
 * turns the silent drop into a real error.
 *
 * Scope is deliberately narrow: only `__proto__`, and only on `Document.assets`.
 * `constructor` / `prototype` / `toString` survive Zod as ordinary own keys and
 * stay valid asset ids (lookups are `$`-prefix guarded), and open `metadata`
 * stays unrestricted.
 */
function rejectProtoAssetKey(json: unknown): void {
  if (json === null || typeof json !== "object") return;
  const assets = (json as { assets?: unknown }).assets;
  if (assets === null || typeof assets !== "object") return;
  if (Object.hasOwn(assets, "__proto__")) {
    throw new IRValidationError([
      {
        path: "assets.__proto__",
        message:
          'Asset record key "__proto__" is not allowed: the validator would silently drop it, losing the asset.',
      },
    ]);
  }
}

export function loadAndValidateIR(json: unknown): Document {
  rejectProtoAssetKey(json);
  const result = DocumentSchema.safeParse(json);
  if (!result.success) {
    throw new IRValidationError(result.error);
  }
  return result.data as Document;
}
