/**
 * Adapter layer: converts between panel camelCase settings
 * and the exporter's snake_case format.
 *
 * This is the firewall that prevents panel UI schema from leaking into core.
 */

import type { PanelSettingKey, PanelSettings } from "../shared/types.js";

/** Map of panelKey → exporter snake_case key. */
const KEY_MAP: Record<string, string> = {
  output: "output",
  imageFormat: "image_format",
  jpgQuality: "jpg_quality",
  pngNumberOfColors: "png_number_of_colors",
  use2xImages: "use_2x_images_if_possible",
  responsiveness: "responsiveness",
  renderTextAs: "render_text_as",
  htmlOutputPath: "html_output_path",
  imageOutputPath: "image_output_path",
  namespace: "namespace",
  projectName: "project_name",
  htmlOutputExtension: "html_output_extension",
  imageSourcePath: "image_source_path",
  textResponsiveness: "text_responsiveness",
  maxWidth: "max_width",
  centerHtmlOutput: "center_html_output",
  renderRotatedSkewedTextAs: "render_rotated_skewed_text_as",
  googleFonts: "google_fonts",
  testingMode: "testing_mode",
  includeResizerCss: "include_resizer_css",
  includeResizerWidths: "include_resizer_widths",
  svgEmbedImages: "svg_embed_images",
  pngTransparent: "png_transparent",
  cacheBustToken: "cache_bust_token",
  clickableLink: "clickable_link",
  altText: "alt_text",
  ariaRole: "aria_role",
};

/** Reverse map: exporter snake_case → panelKey. */
const REVERSE_KEY_MAP: Record<string, string> = {};
for (const [panel, exporter] of Object.entries(KEY_MAP)) {
  REVERSE_KEY_MAP[exporter] = panel;
}

export function exporterToPanelKey(exporterKey: string): PanelSettingKey | undefined {
  return REVERSE_KEY_MAP[exporterKey] as PanelSettingKey | undefined;
}

/**
 * Convert panel camelCase settings to the exporter's snake_case format.
 * Only includes keys that are explicitly set (not undefined).
 * All values become strings (matching ai2html-settings text block format).
 */
export function panelToExporterSettings(panel: PanelSettings): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [panelKey, exporterKey] of Object.entries(KEY_MAP)) {
    const value = (panel as Record<string, unknown>)[panelKey];
    if (value !== undefined && value !== null) {
      out[exporterKey] = String(value);
    }
  }

  return out;
}

/**
 * Convert exporter snake_case settings back to panel camelCase format.
 * Used when loading settings from config files.
 */
export function exporterToPanelSettings(exporter: Record<string, unknown>): PanelSettings {
  const panel: Record<string, unknown> = {};

  for (const [exporterKey, value] of Object.entries(exporter)) {
    const panelKey = REVERSE_KEY_MAP[exporterKey] ?? (exporterKey in KEY_MAP ? exporterKey : "");
    if (panelKey && value !== undefined) {
      // Parse known types
      if (typeof value === "string") {
        if (value === "true") panel[panelKey] = true;
        else if (value === "false") panel[panelKey] = false;
        else if (/^\d+$/.test(value)) panel[panelKey] = parseInt(value, 10);
        else panel[panelKey] = value;
      } else {
        panel[panelKey] = value;
      }
    }
  }

  return panel as PanelSettings;
}
