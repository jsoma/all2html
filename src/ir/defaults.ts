import type { Settings } from "./types.js";

export const defaultSettings: Settings = {
  // Image
  imageFormat: ["auto"],
  writeImageFiles: true,
  pngTransparent: false,
  pngNumberOfColors: 128,
  jpgQuality: 85,
  use2xImages: true,
  cacheBustToken: null,

  // Output
  namespace: "g-",
  projectName: "",
  output: "one-file",
  htmlOutputPath: "all2html-output/",
  htmlOutputExtension: ".html",
  imageOutputPath: "all2html-output/",
  imageSourcePath: "",

  // Rendering
  responsiveness: "fixed",
  textResponsiveness: "dynamic",
  maxWidth: null,
  centerHtmlOutput: true,
  renderTextAs: "html",
  renderRotatedSkewedTextAs: "html",
  testingMode: false,

  // Features
  includeResizerCss: true,
  includeResizerWidths: true,
  responsiveImageMode: "img-src",
  useLazyLoader: true,
  inlineSvg: false,
  svgIdPrefix: "",
  svgEmbedImages: false,
  clickableLink: "",
  createPromoImage: false,
  promoImageWidth: 1024,
  localPreviewTemplate: "",
};
