# all2html

all2html converts design documents into responsive web output. Illustrator, Figma, and SVG import all feed the same canonical IR and rendering pipeline, which then emits HTML, Standalone HTML, Svelte, or React output. After Effects export is separate and limited: one comp at a time, video plus timed HTML overlays, without the shared pipeline.

This project is **pre-launch** right now. The public docs are the best place to start:

- [Docs home](docs/index.md)
- [Install guide](docs/install.md)
- [Examples and sample exports](docs/examples/index.md)
- [How it works](docs/how-it-works/index.md)
- [GitHub Releases](https://github.com/jsoma/all2html/releases/latest)

## Developer Quickstart

```bash
pnpm install
pnpm build
pnpm build:illustrator
pnpm build:panel
pnpm build:after-effects
pnpm build:figma
pnpm build:svg-dropzone
```

Docs are authored in `/docs` and built with Zensical:

```bash
pnpm docs:serve
pnpm docs:build
```

`pnpm docs:build` writes the docs site to `site/` and includes the public `svg-converter/` app there.

Engineering-facing hardening and QA docs live in [`internal-docs/`](internal-docs/README.md).
