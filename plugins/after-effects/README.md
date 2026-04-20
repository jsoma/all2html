# all2html After Effects Exporter

For public install and usage docs, start here:

- [Install](../../docs/install.md)
- [After Effects options](../../docs/options/after-effects.md)
- [Examples](../../docs/examples/index.md)

This README is for repo-local development and packaging.

## Build From Source

```bash
pnpm package:after-effects
```

This writes:

- `dist/after-effects/all2html-ae.jsx`
- `dist/all2html-after-effects.zip`

## Shared CEP Panel

The shared `all2html` CEP extension also includes an After Effects panel surface. Build it from the repo root with:

```bash
pnpm build:panel
```

## Developer Notes

- The AE path is temporal/video-oriented, not responsive-artboard-oriented.
- The script and panel both read `all2html-ae.config.json` next to the saved `.aep`.
- The main exported contract is video plus timed HTML overlays from `overlay:` text layers.

Engineering references:

- [After Effects panel install and smoke test](../../internal-docs/after-effects-panel-install-and-smoke-test.md)
- [CEP panel architecture](../../internal-docs/cep-panel-architecture.md)
