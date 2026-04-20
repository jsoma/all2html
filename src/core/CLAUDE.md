# Core Pipeline

Each file is one transform step. Order matters — see `pipeline.ts`.

## Transform chain

1. `resolve-settings.ts` — Merges defaults → JSONC config → IR settings. Returns `ResolvedDocument`.
2. `resolve-settings-pure.ts` — Same but no file I/O (for ExtendScript bundle).
3. `compute-breakpoints.ts` — Sorts artboards by width, assigns visibility ranges. Returns `ResolvedDocument` with breakpoints.
4. `compute-styles.ts` — Converts IR text properties to CSS. `letterSpacing` is already in em (passed through directly). Font lookup via `font-map.ts`. Returns `StyledDocument` + warnings.
5. `deduplicate-styles.ts` — Finds base paragraph style, assigns `g-pstyle{N}` / `g-cstyle{N}` classes. Returns `DeduplicatedDocument`.
6. `compute-positions.ts` — Converts absolute px to percentages. Handles text alignment anchoring, rotated text transforms, and shape positioning (center-point with margin offset). Returns `EmitterReadyDocument`.
7. `group-artboards.ts` — Groups artboards for output: one-file (single group) or multiple-files (group by name).

## Key behaviors

- Color snapping: RGB all < 36 → pure black (ai2html parity)
- Font fallback: unknown fonts get weight guessed from name ("Bold" → 700, else 500)
- Point text gets +22px width padding and `height = line-height` (Chrome zoom fix)
- Style dedup sorts by descending char count then key for determinism
- **Always include all CSS properties** (including `text-align: left`) — don't omit defaults, as the page may have different base styles
- Transforms shallow-clone at boundaries — mutate the clone, not the input
- `resolve-settings*` expects canonical camelCase IR settings. Plugin-specific snake_case or tool-native keys must be normalized before the document reaches the core pipeline.

## Additional modules

- `logger.ts` — Pluggable observability. `ObservableLogger` interface with `startSpan()` for timing. Implementations: `noopLogger` (default, zero overhead), `createConsoleLogger()` (structured output), `createCollectingLogger()` (captures events for tests). Pass to `processDocument()` via `options.logger`.
- `svg-postprocess.ts` — Cleans Illustrator-generated SVG: ID cleanup, hex decode, data-name, non-scaling-stroke, opacity/multiply restoration (BEFORE id cleanup), raster removal. SVG ID replacements sorted longest-first to prevent substring collisions.
- `template.ts` — Mustache/EJS template application. Used by standalone emitter for `local_preview_template`.
- `warnings.ts` — Groups warnings by type for consolidated output.
- `font-map.ts` — Built-in font table + weight-guessing heuristic.
