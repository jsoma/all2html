# Internal Docs

This directory holds engineering-facing documentation that is useful for development, QA, and release hardening, but is not part of the public docs site.

Examples:

- host-app smoke-test checklists
- hardening matrices
- support gates
- CEP architecture notes

Public documentation now lives in `/docs` and is built into the GitHub Pages site with Zensical.

## Docs Site Maintenance

The public site for this repo lives at:

- `https://jsoma.github.io/all2html/`

Docs source is authored in `/docs`, with two exceptions.

### Generated pages

`docs/reference/settings.md` and `docs/reference/support-matrix.md` are **generated** by `scripts/generate-settings-docs.ts` from `src/ir/settings-definitions.ts`, `src/core/capabilities.ts`, and `src/ir/schema.ts`. Do not hand-edit them; the next regeneration discards the edit.

```bash
pnpm docs:generate        # rewrite both pages
pnpm check:generated-docs # fail if the committed pages are stale (runs in CI)
```

To change what those pages say, change the declarations. Prose that has nowhere to live in the declarations (per-setting descriptions for settings with no panel `help`, feature labels, and the tag-grammar notes) lives in the generator itself, in one clearly-marked table each.

### Pending screenshots

`internal-docs/docs-screenshot-checklist.md` tracks the images the public pages still want. Placeholders must not be committed to `docs/` — they render live on the site.

Preview locally:

```bash
pnpm docs:serve
```

Build the static site:

```bash
pnpm docs:build
```

That writes output into `site/`, which is gitignored. It also publishes the browser SVG converter into `site/svg-converter/`. The GitHub Actions docs workflow builds from `/docs` and deploys `site/` to the `gh-pages` branch.
