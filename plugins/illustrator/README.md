# all2html Illustrator Plugin

For release downloads, end-user install steps, and workflow docs, use the public site:

- [Install](../../docs/install.md)
- [Illustrator options](../../docs/options/illustrator.md)
- [Examples](../../docs/examples/index.md)

This README is for repo-local development and source installs.

## Build From Source

```bash
pnpm install
pnpm check:illustrator-fixtures
pnpm build:illustrator
```

This writes the local Illustrator script bundle to `dist/all2html.js`.

## Panel Packaging

```bash
pnpm build:panel
pnpm package:panel
pnpm package:panel:zip
```

These commands build the shared CEP extension, including the Illustrator host surface.

## Developer Notes

- Illustrator remains the deepest special-layer/export surface.
- Document-local settings use the `all2html-settings` text block contract; the legacy `ai2html-settings` name is still accepted (`all2html-` wins key-by-key if both are present).
- Font mappings still come from `all2html.config.json` or the panel UI.

Engineering references:

- [Illustrator hardening matrix](../../internal-docs/illustrator-hardening-matrix.md)
- [Illustrator manual QA checklist](../../internal-docs/illustrator-manual-qa-checklist.md)
- [CEP panel architecture](../../internal-docs/cep-panel-architecture.md)
