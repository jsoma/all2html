# CEP Panel Architecture

Shared architecture and validation notes for the `all2html` CEP extension used by Illustrator and After Effects.

## Scope

The CEP extension is one shared panel build with two host surfaces:

- Illustrator panel UI
- After Effects panel UI

The host-specific forms stay separate, but the shell, bridge, watcher, controller, and diagnostics layers are intentionally shared.

## Structure

### Panel-side TypeScript

- `plugins/illustrator/panel/src/js/bridge.ts`
- `plugins/illustrator/panel/src/js/ae-bridge.ts`
- `plugins/illustrator/panel/src/js/bridge-shared.ts`

These files define the CEP-to-ExtendScript contract. Shared command parsing, folder opening, and diagnostics access live in `bridge-shared.ts`.

- `plugins/illustrator/panel/src/js/document-watcher.ts`
- `plugins/illustrator/panel/src/js/ae-document-watcher.ts`
- `plugins/illustrator/panel/src/js/polling-watcher.ts`

These files handle host polling and document/project change detection. The shared watcher must invalidate in-flight polls on teardown so stale callbacks do not repopulate state.

- `plugins/illustrator/panel/src/js/persistence.ts`
- `plugins/illustrator/panel/src/js/ae-persistence.ts`
- `plugins/illustrator/panel/src/js/default-storage.ts`

These files resolve app defaults, document/project-local config, and host-specific persisted state.

- `plugins/illustrator/panel/src/js/panel-controller.ts`
- `plugins/illustrator/panel/src/js/components/PanelShell.svelte`
- `plugins/illustrator/panel/src/js/components/RunResult.svelte`

These files provide the shared shell, run lifecycle, and output-folder plumbing.

### ExtendScript host layer

- `plugins/illustrator/panel/src/jsx/hostscript.ts`
- `plugins/illustrator/panel/src/jsx/export-runner.ts`
- `plugins/illustrator/panel/src/jsx/diagnostics.ts`

`hostscript.ts` is the callable ExtendScript contract surface. It registers commands, reads host state, runs exports, and exposes diagnostics. `export-runner.ts` holds the shared export execution flow. `diagnostics.ts` stores structured log entries and attaches them to panel results.

### Shared contract

- `plugins/illustrator/panel/src/shared/host-contract.ts`
- `plugins/illustrator/panel/src/shared/types.ts`

These are the source of truth for command names and shared payload types across the CEP panel and ExtendScript host layer.

## Diagnostics Flow

The CEP panel now supports structured diagnostics end to end:

1. Hostscript installs an exporter log sink for each run.
2. Exporters and host helpers write structured entries into diagnostics state.
3. The final result returned to the panel includes a `diagnostics` payload.
4. The panel renders those diagnostics inline on failure or warning-heavy runs.
5. Shell diagnostics can be read directly with:

```bash
pnpm diagnostics:illustrator
pnpm diagnostics:after-effects
```

Use those commands before resorting to screenshots when the panel looks wrong but the underlying host state may still be recoverable.

## Folder Opening

`Open folder` is panel-first, not host-first:

- The panel prefers the CEP Node runtime to open the folder.
- The ExtendScript host command is a fallback only.
- After Effects host fallback must not call `Folder.execute()` because that can hang under host scripting.
- Windows uses `cmd.exe /d /s /c start "" "<path>"` in the CEP Node path rather than depending on `explorer.exe` exit behavior.

This path still needs real Windows host validation even though it now has unit coverage.

## Validation Loop

For CEP changes, the minimum validation loop is:

```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm build:panel
```

Then do host-app smoke:

- Illustrator: open a saved file, edit it so it becomes dirty, confirm the panel does not lose the document path, run export, verify `Open folder`
- After Effects: open a saved project, confirm comp and template loading, run export, verify `Open folder`

## Packaging

`@all2html/panel` has three build targets and they share one `dist/`:

| script | writes | run by |
| --- | --- | --- |
| `build` | `dist/cep/` | `pnpm build:panel` |
| `zxp` | `dist/cep/`, `dist/zxp/<id>.zxp` | `pnpm package:panel` |
| `zip` | `dist/cep/`, `dist/zxp/<id>.zxp`, `dist/zip/<name>_<version>.zip` | `pnpm package:panel:zip` |

Two things follow, and both have already broken CI once:

- **`zip` produces the `.zxp` too.** `vite-cep-plugin` signs the extension whenever
  `isPackage` is set and only *additionally* wraps it when `isMetaPackage` is set,
  so `package:panel:zip` alone yields both release artifacts. Signing needs no
  secret — `ZXPSignCmd` (bundled with the plugin) generates a self-signed
  certificate from the `zxp` block in `cep.config.ts` and timestamps it against a
  public TSA, falling back to an untimestamped signature via `allowSkipTSA`.
- **Each target cleans only what it owns.** The scripts used to start with
  `rimraf dist/*`, which the shell expanded, so whichever target ran second
  deleted the other's output — `package:panel:zip && package:panel` left no zip
  behind, and `pnpm check:release-artifacts` then failed on a zip that had
  existed a minute earlier. They now clean `dist/cep` plus their own output
  directory, so the two targets can run in either order.

## Known Test Gaps

The largest remaining gap is hostscript-focused unit coverage. Shared panel logic is tested well, but the ExtendScript-side helpers still rely more heavily on live host-app verification than the panel-side code.
