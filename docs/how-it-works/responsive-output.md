---
title: Responsive Output
description: Fixed vs dynamic behavior, responsive groups, and multi-artboard output.
---

# Responsive Output

Responsiveness in all2html comes from grouping artboards or frames that represent the same story at different widths.

## Fixed Vs Dynamic

### Fixed

Use fixed when the artboard should render at a defined width and swap to another artboard when a breakpoint is crossed.

### Dynamic

Use dynamic when the layout itself should scale more fluidly instead of behaving like a locked-width panel.

## Grouping

Different input surfaces express grouping differently, but they all map to the same idea:

- Illustrator: related artboards
- Figma: selected frames with the same base name
- SVG import: related files such as `story--640.svg` and `story--960.svg`

The pipeline then turns those into responsive groups that emitters can render consistently.

## Image Handling

Responsive image handling also stays in the shared settings surface. That is why imported SVGs, Illustrator exports, and Figma exports can all feed the same HTML/CSS image behavior.

## Failure Cases

The important rule is that grouping should be explicit and trustworthy. Equal-width variants in the same group fail instead of silently guessing.
