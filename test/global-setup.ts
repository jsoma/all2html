/**
 * Builds every ExtendScript artifact the suite inspects, once, before any test
 * worker starts.
 *
 * Previously each test built on demand under a cross-process lock. That lock
 * covered the *build* but not the *read*: `ensureFreshArtifact` released it
 * before returning the path, so one worker could be reading
 * `dist/all2html.js` while another worker's `pnpm build:panel` — which rebuilds
 * the same tree — was rewriting it. The truncated read surfaced as a
 * size-budget failure, which reads exactly like a real finding and cost several
 * re-runs to dismiss. Isolated re-runs always passed, which is the signature.
 *
 * Building here removes the concurrency instead of synchronizing it: by the
 * time workers exist, every artifact is final and read-only for the rest of the
 * run. Staleness is still honored, so an untouched `dist/` costs nothing.
 */
import { buildArtifacts } from "./helpers/extendscript-build.js";

export default function setup(): void {
  buildArtifacts();
}
