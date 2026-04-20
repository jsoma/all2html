# Figma Plugin

For the public workflow and export docs, start here:

- [Install](../../docs/install.md)
- [Figma options](../../docs/options/figma.md)
- [How it works](../../docs/how-it-works/index.md)
- [Examples](../../docs/examples/index.md)

This README is for repo-local plugin development.

## Build And Import

```bash
pnpm install
pnpm build:figma
```

Then in Figma:

1. Choose **Import plugin from manifest...**
2. Select `plugins/figma/manifest.json`

`manifest.json` points at built files in `dist/`, so the whole plugin directory must remain intact.

## Current Developer Contract

- export roots are selected top-level frames
- frame naming follows all2html annotations like `story:640`, `story:dynamic`, `story:image`
- the plugin produces canonical IR first, then runs the shared pipeline and emitters
- the current UI exports `HTML` and `Standalone HTML`
- shared config lives in `figma.root` plugin data
- local convenience state lives in `figma.clientStorage`

## Special Layers

The plugin currently recognizes these top-level tagged child nodes inside selected frames:

- `:png`
- `:svg`
- `:svg:inline`
- `:video`
- `:html-before`
- `:html-after`

## Developer References

- [Figma support gate](../../internal-docs/figma-support-gate.md)
- [Canonical IR docs](../../docs/how-it-works/canonical-ir.md)
