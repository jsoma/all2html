/**
 * Panel/docs help copy for settings.
 *
 * This is deliberately a **sibling** of `settings-definitions.ts` rather than a
 * `help` field on each definition. `SETTING_DEFINITIONS` is imported by
 * `schema.ts`, `defaults.ts`, and `core/capabilities.ts`, so it is pulled into
 * the ExtendScript core bundle — and rollup cannot tree-shake individual
 * properties out of an object literal inside an array literal, so every byte of
 * this prose shipped into Illustrator even though only the CEP panel and the
 * docs generator ever read it (~11.8 KB of a 113 KB bundle).
 *
 * Nothing in the ExtendScript entry graph (`src/extendscript/index.ts`) may
 * import this module. `test/integration/extendscript-bundle.test.ts` pins that
 * by asserting the bundle contains none of this copy.
 */
import type { Settings } from "./types.js";

export interface SettingHelpDefinition {
  label: string;
  summary: string;
  details?: string;
  defaultNote?: string;
  optionNotes?: Record<string, string>;
  docsAnchor: string;
}

export const SETTING_HELP = {
  imageFormat: {
    label: "Format",
    summary: "Chooses the raster or vector format used for exported background artwork.",
    details:
      "Auto lets the pipeline pick a reasonable image format. SVG keeps vector layers where possible, while PNG and JPEG trade off transparency, file size, and fidelity.",
    defaultNote: "Start with Auto unless you know the output needs a specific format.",
    optionNotes: {
      Auto: "Lets all2html choose the image format based on the artwork.",
      "PNG (8-bit)": "Palette-based PNG. Good for flatter graphics with fewer colors.",
      "PNG (24-bit)": "Full-color PNG. Larger but more faithful, with transparency support.",
      JPEG: "Smaller for photo-heavy graphics, but no transparency and more compression artifacts.",
      SVG: "Keeps vector output when compatible, but can expose more browser rendering differences.",
    },
    docsAnchor: "imageFormat",
  },
  use2xImages: {
    label: "Retina (2x) images",
    summary: "Exports high-density image assets so the graphic looks sharper on retina screens.",
    details:
      "This writes larger source images and scales them down in the browser. It usually improves crispness, but increases image weight.",
    defaultNote: "Leave this on for production web graphics unless file size is unusually tight.",
    docsAnchor: "use2xImages",
  },
  output: {
    label: "Output",
    summary:
      "Controls whether related artboards are emitted into one HTML file or split into separate files.",
    details:
      "Single file is the classic ai2html-style output for responsive artboard groups. Per artboard writes a separate file for each base artboard group.",
    defaultNote:
      "Use Single file for one graphic with breakpoints; use Per artboard when each artboard should stand alone.",
    optionNotes: {
      "Single file": "Emits one HTML file that can contain responsive artboard variants together.",
      "Per artboard":
        "Writes separate output files instead of bundling all artboards into one result.",
    },
    docsAnchor: "output",
  },
  htmlOutputPath: {
    label: "HTML path",
    summary:
      "Folder where the exported HTML files are written, relative to the Illustrator document unless you use an absolute path.",
    details:
      "By default, all2html writes next to the document in all2html-output/. Use a different folder when your publishing workflow expects HTML somewhere else.",
    defaultNote: "Most projects can leave this at all2html-output/.",
    docsAnchor: "htmlOutputPath",
  },
  imageOutputPath: {
    label: "Image path",
    summary: "Folder where exported image assets are written.",
    details:
      "Illustrator writes the HTML and its images into one folder, and HTML path wins when both are set — so this can move that folder, but it cannot put the images somewhere separate. To point the markup at a different location than the files were written to, use Image src prefix.",
    defaultNote: "Keep it aligned with HTML path unless you have a specific asset pipeline.",
    docsAnchor: "imageOutputPath",
  },
  responsiveness: {
    label: "Layout",
    summary:
      "Controls whether artboards export at fixed widths or as layouts that can stretch with the container.",
    details:
      "Fixed swaps between artboards at breakpoints while keeping each artboard width locked. Dynamic lets an artboard scale more fluidly and uses aspect-ratio spacing in the HTML.",
    defaultNote: "Leave this on Fixed unless the layout itself should stretch between breakpoints.",
    optionNotes: {
      Fixed: "Keeps each artboard at a defined width and swaps variants at breakpoints.",
      Dynamic: "Lets an artboard scale more fluidly instead of behaving like a locked-width panel.",
    },
    docsAnchor: "responsiveness",
  },
  textResponsiveness: {
    label: "Text sizing",
    summary:
      "Controls whether live HTML text keeps fixed sizing or scales more dynamically with the layout.",
    details:
      "This only matters when text is emitted as HTML. Dynamic text sizing produces more flexible text positioning, while Fixed keeps the text box behavior closer to the Illustrator artboard.",
    defaultNote: "Dynamic is the safer default for live HTML text.",
    optionNotes: {
      Dynamic: "Lets live HTML text scale and reposition more fluidly.",
      Fixed: "Keeps live HTML text closer to fixed artboard geometry.",
    },
    docsAnchor: "textResponsiveness",
  },
  renderTextAs: {
    label: "Text as",
    summary:
      "Chooses whether text is emitted as live HTML or baked into the exported background image.",
    details:
      "HTML text stays searchable, selectable, and styleable, but depends on browser fonts. Image text preserves Illustrator appearance more exactly, but it is no longer live text.",
    defaultNote: "Use HTML unless fidelity problems force you to rasterize the type.",
    optionNotes: {
      HTML: "Keeps text live in the markup for accessibility, search, and CSS styling.",
      Image: "Renders text into the exported image for maximum visual fidelity.",
    },
    docsAnchor: "renderTextAs",
  },
  googleFonts: {
    label: "Google Fonts",
    summary: "Optionally adds Google Fonts loading markup for mapped live text fonts.",
    details:
      "The generated URL is based on the first concrete CSS family in each font mapping. all2html does not validate whether the family exists on Google Fonts; invalid requests fall back through normal browser font behavior.",
    defaultNote: "Off keeps exports self-contained and avoids external font requests.",
    optionNotes: {
      Off: "Does not emit Google Fonts loading markup.",
      "CSS @import":
        "Adds an @import rule at the top of generated CSS. This is the recommended enabled mode for snippets.",
      "Link tag": "Adds preconnect and stylesheet link tags before generated style output.",
    },
    docsAnchor: "googleFonts",
  },
  includeResizerCss: {
    label: "Container query CSS",
    summary: "Adds the responsive CSS rules that switch between artboards at breakpoints.",
    details:
      "Without this CSS, multi-artboard responsive output loses the generated container-query rules that show the right variant at the right width.",
    defaultNote: "Leave this on unless you are intentionally replacing the generated CSS.",
    docsAnchor: "includeResizerCss",
  },
  inlineSvg: {
    label: "Inline SVG layers",
    summary:
      "Keeps eligible SVG layers inline in the HTML instead of rasterizing them into background images.",
    details:
      "Inline SVG can make vector details stay crisp and stylable, but it also produces more verbose HTML and can reveal browser rendering differences.",
    defaultNote: "Leave this off unless you specifically need live vector layers in the markup.",
    docsAnchor: "inlineSvg",
  },
  svgEmbedImages: {
    label: "Embed images in SVG",
    summary:
      "Embeds image assets directly inside inline SVG output instead of referencing separate files.",
    details:
      "This can make a self-contained SVG fragment, but it increases HTML size and duplicates binary image data.",
    defaultNote: "Leave this off unless you need a fully self-contained SVG fragment.",
    docsAnchor: "svgEmbedImages",
  },
} as const satisfies Partial<Record<keyof Settings, SettingHelpDefinition>>;

export function getSettingHelpDefinition(key: string): SettingHelpDefinition | undefined {
  return (SETTING_HELP as Record<string, SettingHelpDefinition | undefined>)[key];
}
