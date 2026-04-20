---
title: Install
description: Download and install all2html for Illustrator, After Effects, Figma, and SVG conversion.
---

# Install

This is the main install page. Start with the direct download links below.

## Start Here

- [Download Illustrator script](https://github.com/jsoma/all2html/releases/latest/download/all2html.js)
- [Download panel `.zxp`](https://github.com/jsoma/all2html/releases/latest/download/all2html-panel.zxp)
- [Download panel `.zip`](https://github.com/jsoma/all2html/releases/latest/download/all2html-panel.zip)
- [Install `.zxp` with ZXPInstaller](https://zxpinstaller.com/)
- [Download After Effects script](https://github.com/jsoma/all2html/releases/latest/download/all2html-after-effects.zip)
- [Download Figma plugin](https://github.com/jsoma/all2html/releases/latest/download/all2html-figma-plugin.zip)
- [Open the SVG browser converter](https://jsoma.github.io/all2html/svg-converter/)
- [Latest release page](https://github.com/jsoma/all2html/releases/latest)

## Illustrator Script

Use this when you want the classic ai2html-style flow.

Direct download: [all2html.js](https://github.com/jsoma/all2html/releases/latest/download/all2html.js)

1. Download `all2html.js`.
2. In Illustrator, choose **File → Scripts → Other Script**.
3. Select `all2html.js`.

For permanent install, copy it into Illustrator’s Scripts folder and restart Illustrator.

[Illustrator details and options](options/illustrator.md)

> Screenshot placeholder
> Crop the Illustrator Scripts menu and the file picker or installed script entry.

## Illustrator/After Effects Panel

The extension gives you a shared interface for Illustrator and After Effects.

Direct downloads:

- [Panel `.zxp`](https://github.com/jsoma/all2html/releases/latest/download/all2html-panel.zxp)
- [Panel `.zip`](https://github.com/jsoma/all2html/releases/latest/download/all2html-panel.zip)
- [ZXPInstaller](https://zxpinstaller.com/)

1. Download the latest panel `.zxp`.
2. Install it with an extension manager like [ZXPInstaller](https://zxpinstaller.com/).
3. Restart Illustrator or After Effects.
4. Open the panel from the app’s Extensions menu.

[Illustrator panel details](options/illustrator.md)
[After Effects panel details](options/after-effects.md)

> Screenshot placeholder
> Crop the panel open inside the host app with the main settings section visible.

## After Effects Script

Use this when you want the packaged `.jsx` workflow.

Direct download: [all2html-after-effects.zip](https://github.com/jsoma/all2html/releases/latest/download/all2html-after-effects.zip)

1. Download `all2html-after-effects.zip`.
2. Unzip it.
3. Run `all2html-ae.jsx` from **File → Scripts → Run Script File...**, or copy it into the app’s Scripts folder for permanent install.

This exporter works on the active comp in a saved `.aep` project.

[After Effects details and options](options/after-effects.md)

> Screenshot placeholder
> Crop the AE Scripts menu or Run Script dialog with `all2html-ae.jsx` selected.

## Figma Plugin

Direct download: [all2html-figma-plugin.zip](https://github.com/jsoma/all2html/releases/latest/download/all2html-figma-plugin.zip)

1. Download `all2html-figma-plugin.zip`.
2. Unzip it.
3. In Figma, choose **Import plugin from manifest...**
4. Select `manifest.json` from the extracted plugin folder.

The extracted folder needs to stay intact because the manifest points at the built plugin files inside `dist/`.

The plugin works from selected top-level frames and currently exports HTML or Standalone HTML from the UI.

[Figma details and options](options/figma.md)

> Screenshot placeholder
> Crop the manifest import dialog and the plugin panel export controls.

## SVG Conversion

There are two ways to use the SVG conversion path right now:

- CLI: useful for automation and repeatable exports
- Browser app: useful when you want drag-and-drop conversion without writing code

Open the browser app: [SVG browser converter](https://jsoma.github.io/all2html/svg-converter/)

Local commands:

```bash
pnpm install
pnpm build
pnpm build:svg-dropzone
pnpm dev:svg-dropzone
```

[SVG conversion details and options](options/svg-conversion.md)

> Screenshot placeholder
> Crop the SVG dropzone with one uploaded file and the generated output summary visible.

## Build From Source

If you want every surface available locally:

```bash
pnpm install
pnpm build
pnpm build:illustrator
pnpm build:panel
pnpm package:after-effects
pnpm build:figma
pnpm build:svg-dropzone
```

The repo root is also where the diagnostics and verification commands live:

```bash
pnpm diagnostics:illustrator
pnpm diagnostics:after-effects
pnpm exec vitest run
pnpm exec tsc --noEmit
```
