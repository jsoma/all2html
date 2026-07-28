#!/usr/bin/env node

/**
 * Bin entry. Everything testable lives in `run.ts`; this file owns the two
 * process-level concerns: a concise `Error: <message>` (no stack trace) and
 * exit code 1 on any failure — including the parse errors that used to escape
 * `main()` as unhandled rejections.
 */
import { runCli } from "./run.js";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
