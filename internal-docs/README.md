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

Docs source is authored in `/docs`.

Preview locally:

```bash
pnpm docs:serve
```

Build the static site:

```bash
pnpm docs:build
```

That writes output into `site/`, which is gitignored. It also publishes the browser SVG converter into `site/svg-converter/`. The GitHub Actions docs workflow builds from `/docs` and deploys `site/` to the `gh-pages` branch.
