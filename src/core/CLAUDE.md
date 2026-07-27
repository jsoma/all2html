# Core Pipeline

Each file is one transform step. Order matters — see `pipeline.ts`.

## Transform chain

1. `resolve-settings.ts` — Merges defaults → JSONC config → IR settings. Returns `ResolvedDocument`.
1b. `capabilities.ts` — Validates the resolved settings against what the active surface actually produces. Emits `setting:unsupported` warnings; changes no document state.
2. `resolve-settings-pure.ts` — Same but no file I/O (for ExtendScript bundle).
3. `compute-breakpoints.ts` — Sorts artboards by width, assigns visibility ranges. Consumes `ResolvedDocument`, returns `BreakpointedDocument`. These are distinct types on purpose: `breakpoint` does not exist before this runs, so the transform can be neither skipped nor repeated.
4. `compute-styles.ts` — Converts IR text properties to CSS. `letterSpacing` is already in em (passed through directly). Font lookup via `font-map.ts`. Returns `StyledDocument` + warnings.
5. `deduplicate-styles.ts` — Finds base paragraph style, assigns `g-pstyle{N}` / `g-cstyle{N}` classes. Returns `DeduplicatedDocument`. It assigns class names only — positions belong to the next phase, so it inserts no `computedPosition`.
6. `compute-positions.ts` — Converts absolute px to percentages. Handles text alignment anchoring, rotated text transforms, and shape positioning (center-point with margin offset). Returns `EmitterReadyDocument`.
7. `group-artboards.ts` — Groups artboards for output: one-file (single group) or multiple-files (group by name).

## Key behaviors

- Color snapping: RGB all < 36 → pure black (ai2html parity)
- Font fallback: unknown fonts get weight guessed from name ("Bold" → 700, else 500)
- Point text gets +22px width padding and `height = line-height` (Chrome zoom fix)
- Style dedup sorts by descending char count then key for determinism
- **Always include all CSS properties** (including `text-align: left`) — don't omit defaults, as the page may have different base styles
- Transforms shallow-clone at boundaries — mutate the clone, not the input
- Every transform sets the next `pipelinePhase` literal in its return object and annotates its return type. Never widen a signature to accept "the document at whatever phase" — that is the defect the phase literals exist to prevent
- Narrow elements with their declared discriminants (`el.type`, `el.renderAs`), never by probing for a computed field
- `resolve-settings*` expects canonical camelCase IR settings. Plugin-specific snake_case or tool-native keys must be normalized before the document reaches the core pipeline.

## Additional modules

- `logger.ts` — Pluggable observability. `ObservableLogger` interface with `startSpan()` for timing. Implementations: `noopLogger` (default, zero overhead), `createConsoleLogger()` (structured output), `createCollectingLogger()` (captures events for tests). Pass to `processDocument()` via `options.logger`.
- `template.ts` — Mustache/EJS template application. Used by standalone emitter for `local_preview_template`.
- `warnings.ts` — The structured warning type. Every warning carries a stable `code` and a `category` **assigned at the call site**, plus optional `artboardId`/`layerId`/`elementId`/`setting`/`surface`. `warningMessages()` is the plain-string projection kept on every public result. `groupWarnings()` groups by the declared category — it never inspects the message text. Replaced the substring classifier (`w.includes("font")`) that used to live here.
- `capabilities.ts` — Per-surface capability declarations (SPEC §12.5), seeded from `internal-docs/capability-matrix.md` and keyed by `SETTING_DEFINITIONS`. `checkSurfaceCapabilities()` warns (`setting:unsupported`) whenever the requested value is not what the active surface will produce. The comparison is against the surface's real behavior — `divergesAtDefault` when it differs from the global default — never against the default itself; comparing against the default is silent exactly where the surface breaks its promise (D25). `warnedByEmitter` hands content-dependent cases to the emitter that produces the harm. `runtimeChecked: false` marks a declaration nobody runs (After Effects only). Declarations are data — do not add per-setting conditionals.
- `font-map.ts` — Built-in font table + weight-guessing heuristic.
