import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..").replace(/\\/g, "/");
const tmpDir = mkdtempSync(join(tmpdir(), "all2html-fixtures-"));
const jsxPath = join(tmpDir, "generate-fixtures.jsx");
const requestedNames = process.argv.slice(2);
const fixtureNames = [
  "settings-precedence",
  "rotated-text-real",
  "rotated-text-image",
  "character-styles-real",
  "font-mapping-real",
  "overset-text-real",
  "hyperlinks",
  "accessibility",
  "layer-export-matrix",
  "video-editorial",
  "html-hooks-editorial",
  "large-story",
] as const;

const unknownNames = requestedNames.filter((name) => !fixtureNames.includes(name as (typeof fixtureNames)[number]));
if (unknownNames.length > 0) {
  throw new Error(
    `Unknown Illustrator hardening fixture(s): ${unknownNames.join(", ")}. Known fixtures: ${fixtureNames.join(", ")}`,
  );
}

const jsx = `var ROOT = "${rootDir}";
var previousInteraction = null;
try {
  previousInteraction = app.userInteractionLevel;
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
} catch (e) {}

function ensureFolder(path) {
  var folder = new Folder(path);
  if (!folder.exists) folder.create();
  return folder;
}

function saveDoc(doc, dirPath, fileName) {
  ensureFolder(dirPath);
  var file = new File(dirPath + "/" + fileName);
  var options = new IllustratorSaveOptions();
  options.pdfCompatible = true;
  doc.saveAs(file, options);
  doc.close(SaveOptions.DONOTSAVECHANGES);
}

function findFont(names) {
  for (var i = 0; i < names.length; i++) {
    try {
      return app.textFonts.getByName(names[i]);
    } catch (e) {}
  }
  return null;
}

function setRangeStyle(range, opts) {
  var target = range.textRange ? range.textRange : range;
  var attrs = target.characterAttributes;
  if (opts.fontNames) {
    var font = findFont(opts.fontNames);
    if (font) attrs.textFont = font;
  }
  if (opts.size) attrs.size = opts.size;
  if (opts.tracking !== undefined) attrs.tracking = opts.tracking;
  if (opts.caps) attrs.capitalization = FontCapsOption.ALLCAPS;
}

function addPointText(doc, layer, text, left, top, opts) {
  var tf = layer.textFrames.add();
  tf.contents = text;
  tf.left = left;
  tf.top = top;
  if (opts && opts.name) tf.name = opts.name;
  if (opts && opts.fontNames) {
    var font = findFont(opts.fontNames);
    if (font) tf.textRange.characterAttributes.textFont = font;
  }
  if (opts && opts.size) tf.textRange.characterAttributes.size = opts.size;
  if (opts && opts.bold) tf.textRange.characterAttributes.textFont = findFont(opts.bold);
  if (opts && opts.rotate) tf.rotate(opts.rotate);
  return tf;
}

function addAreaText(doc, layer, text, left, top, width, height, opts) {
  var rect = layer.pathItems.rectangle(top, left, width, height);
  rect.stroked = false;
  rect.filled = false;
  var tf = layer.textFrames.areaText(rect);
  tf.contents = text;
  if (opts && opts.name) tf.name = opts.name;
  if (opts && opts.fontNames) {
    var font = findFont(opts.fontNames);
    if (font) tf.textRange.characterAttributes.textFont = font;
  }
  if (opts && opts.size) tf.textRange.characterAttributes.size = opts.size;
  return tf;
}

function addSettingsBlock(layer, content) {
  var tf = layer.textFrames.add();
  tf.contents = content;
  tf.left = 20;
  tf.top = 380;
  tf.name = "ai2html-settings";
  tf.textRange.characterAttributes.size = 9;
  return tf;
}

function addSpecialBlock(layer, header, content, opts) {
  var tf = layer.textFrames.add();
  tf.contents = header + "\\n" + content;
  tf.left = (opts && opts.left) || 20;
  tf.top = (opts && opts.top) || 380;
  tf.textRange.characterAttributes.size = 9;
  if (opts && opts.hidden) tf.hidden = true;
  if (opts && opts.name) tf.name = opts.name;
  return tf;
}

function addLayer(doc, name) {
  var layer = doc.layers.add();
  layer.name = name;
  return layer;
}

function rgbColor(r, g, b) {
  var color = new RGBColor();
  color.red = r;
  color.green = g;
  color.blue = b;
  return color;
}

function addRectangle(layer, left, top, width, height, rgb, name) {
  var rect = layer.pathItems.rectangle(top, left, width, height);
  rect.stroked = false;
  rect.filled = true;
  rect.fillColor = rgbColor(rgb[0], rgb[1], rgb[2]);
  if (name) rect.name = name;
  return rect;
}

function addCircle(layer, left, top, size, rgb, name) {
  var ellipse = layer.pathItems.ellipse(top, left, size, size);
  ellipse.stroked = false;
  ellipse.filled = true;
  ellipse.fillColor = rgbColor(rgb[0], rgb[1], rgb[2]);
  if (name) ellipse.name = name;
  return ellipse;
}

function newDoc(name, width, height) {
  var doc = app.documents.add(DocumentColorSpace.RGB, width, height);
  doc.artboards[0].name = "desktop";
  doc.documentColorSpace = DocumentColorSpace.RGB;
  doc.layers[0].name = "content";
  return doc;
}

function addArtboard(doc, left, top, width, height, name) {
  var rect = [left, top, left + width, top - height];
  var artboard = doc.artboards.add(rect);
  artboard.name = name;
  return artboard;
}

function createSettingsPrecedence() {
  var dir = ROOT + "/data/settings-precedence";
  var doc = newDoc("settings-precedence", 640, 420);
  var layer = doc.layers[0];

  addSettingsBlock(layer, "ai2html-settings\\nimage_format: png\\noutput: one-file");
  addPointText(doc, layer, "Settings precedence fixture", 40, 330, {
    name: "settings-title",
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 28
  });
  addAreaText(
    doc,
    layer,
    "Text block should beat config for image format. Config should still provide max width and jpg quality for unlocked keys.",
    40,
    270,
    420,
    120,
    { name: "settings-body", fontNames: ["ArialMT", "MyriadPro-Regular"], size: 16 }
  );

  saveDoc(doc, dir, "settings-precedence.ai");
}

function createRotatedTextReal() {
  var dir = ROOT + "/data/rotated-text-real";
  var doc = newDoc("rotated-text-real", 640, 420);
  var layer = doc.layers[0];

  addPointText(doc, layer, "Rotated text should stay HTML", 40, 340, {
    name: "rotated-title",
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 26
  });
  addPointText(doc, layer, "Angle 28", 280, 190, {
    name: "rotated-label",
    fontNames: ["ArialMT", "MyriadPro-Regular"],
    size: 22,
    rotate: 28
  });

  saveDoc(doc, dir, "rotated-text-real.ai");
}

function createRotatedTextImage() {
  var dir = ROOT + "/data/rotated-text-image";
  var doc = newDoc("rotated-text-image", 640, 420);
  var layer = doc.layers[0];

  addSettingsBlock(layer, "ai2html-settings\\nrender_rotated_skewed_text_as: image");
  addPointText(doc, layer, "Rotated text can rasterize", 40, 340, {
    name: "rotated-image-title",
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 26
  });
  addPointText(doc, layer, "Raster me", 320, 200, {
    name: "rotated-image-label",
    fontNames: ["ArialMT", "MyriadPro-Regular"],
    size: 28,
    rotate: -32
  });

  saveDoc(doc, dir, "rotated-text-image.ai");
}

function createCharacterStylesReal() {
  var dir = ROOT + "/data/character-styles-real";
  var doc = newDoc("character-styles-real", 700, 420);
  var layer = doc.layers[0];
  var tf = addPointText(doc, layer, "Normal Bold Italic Caps Track", 40, 300, {
    name: "character-styles-line",
    fontNames: ["ArialMT", "MyriadPro-Regular"],
    size: 24
  });

  setRangeStyle(tf.words[0], { fontNames: ["ArialMT", "MyriadPro-Regular"] });
  setRangeStyle(tf.words[1], { fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"] });
  setRangeStyle(tf.words[2], { fontNames: ["Arial-ItalicMT", "ArialMT", "MyriadPro-It"] });
  setRangeStyle(tf.words[3], { caps: true });
  setRangeStyle(tf.words[4], { tracking: 200 });

  addPointText(doc, layer, "Mixed styles in a single text frame", 40, 360, {
    name: "character-styles-title",
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 20
  });

  saveDoc(doc, dir, "character-styles-real.ai");
}

function createFontMappingReal() {
  var dir = ROOT + "/data/font-mapping-real";
  var doc = newDoc("font-mapping-real", 700, 420);
  var layer = doc.layers[0];

  addPointText(doc, layer, "Mapped font sample", 40, 320, {
    name: "mapped-font",
    fontNames: ["MyriadPro-Regular", "ArialMT"],
    size: 28
  });
  addPointText(doc, layer, "Unmapped font sample", 40, 250, {
    name: "unmapped-font",
    fontNames: ["MinionPro-Regular", "TimesNewRomanPSMT", "ArialMT"],
    size: 24
  });
  addPointText(doc, layer, "Font mapping fixture", 40, 370, {
    name: "font-mapping-title",
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 20
  });

  saveDoc(doc, dir, "font-mapping-real.ai");
}

function createOversetTextReal() {
  var dir = ROOT + "/data/overset-text-real";
  var doc = newDoc("overset-text-real", 720, 460);
  var layer = doc.layers[0];

  addPointText(doc, layer, "Overset text fixture", 40, 390, {
    name: "overset-title",
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 24
  });
  addAreaText(
    doc,
    layer,
    "This area text is intentionally too long for its frame. It should trigger the exporter overset warning and still preserve visible content in the generated HTML output for regression testing.",
    40,
    330,
    220,
    60,
    { name: "overset-body", fontNames: ["ArialMT", "MyriadPro-Regular"], size: 16 }
  );

  saveDoc(doc, dir, "overset-text-real.ai");
}

function createHyperlinks() {
  var dir = ROOT + "/data/hyperlinks";
  var doc = newDoc("hyperlinks", 680, 420);
  var layer = doc.layers[0];

  addSettingsBlock(
    layer,
    "ai2html-settings\\nclickable_link: https://example.com/story\\noutput: one-file"
  );
  addPointText(doc, layer, "Hyperlink fixture", 40, 360, {
    name: "hyperlinks-title",
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 26
  });
  addAreaText(
    doc,
    layer,
    "This document proves the supported Illustrator contract for clickable_link: exported text remains HTML and the graphic is wrapped in a real anchor.",
    40,
    300,
    430,
    120,
    { name: "hyperlinks-body", fontNames: ["ArialMT", "MyriadPro-Regular"], size: 16 }
  );
  addRectangle(layer, 480, 325, 120, 120, [38, 128, 235], "hyperlinks-card");

  saveDoc(doc, dir, "hyperlinks.ai");
}

function createAccessibility() {
  var dir = ROOT + "/data/accessibility";
  var doc = newDoc("accessibility", 680, 420);
  var layer = doc.layers[0];

  addSettingsBlock(
    layer,
    "ai2html-settings\\nalt_text: Accessibility fixture alt text\\naria_role: img\\nclickable_link: https://example.com/accessibility"
  );
  addPointText(doc, layer, "Accessibility fixture", 40, 360, {
    name: "accessibility-title",
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 26
  });
  addAreaText(
    doc,
    layer,
    "The exported container should expose alt text through aria-describedby and keep the configured ARIA role.",
    40,
    300,
    440,
    120,
    { name: "accessibility-body", fontNames: ["ArialMT", "MyriadPro-Regular"], size: 16 }
  );
  addCircle(layer, 520, 250, 80, [45, 157, 120], "accessibility-badge");

  saveDoc(doc, dir, "accessibility.ai");
}

function createLayerExportMatrix() {
  var dir = ROOT + "/data/layer-export-matrix";
  var doc = newDoc("layer-export-matrix", 760, 480);
  var contentLayer = doc.layers[0];

  addPointText(doc, contentLayer, "Layer export matrix", 40, 420, {
    name: "matrix-title",
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 28
  });
  addAreaText(
    doc,
    contentLayer,
    "One file proving external SVG assets, inline SVG markup, and transparent PNG overlays all survive the Illustrator extraction boundary.",
    40,
    360,
    460,
    120,
    { name: "matrix-body", fontNames: ["ArialMT", "MyriadPro-Regular"], size: 16 }
  );
  addRectangle(contentLayer, 36, 332, 520, 6, [210, 210, 210], "matrix-divider");

  var svgLayer = addLayer(doc, "external:svg");
  addRectangle(svgLayer, 520, 390, 180, 120, [230, 57, 70], "external-box");
  addCircle(svgLayer, 560, 350, 42, [255, 201, 40], "external-dot");

  var inlineLayer = addLayer(doc, "inline-art:svg,inline");
  addCircle(inlineLayer, 590, 280, 90, [38, 128, 235], "inline-circle");
  addRectangle(inlineLayer, 635, 245, 80, 18, [255, 255, 255], "inline-bar");

  var pngLayer = addLayer(doc, "overlay:png");
  addRectangle(pngLayer, 470, 210, 180, 90, [16, 185, 129], "overlay-card");
  addPointText(doc, pngLayer, "PNG", 522, 170, {
    name: "overlay-label",
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 30
  });

  saveDoc(doc, dir, "layer-export-matrix.ai");
}

function createVideoEditorial() {
  var dir = ROOT + "/data/video-editorial";
  var doc = newDoc("video-editorial", 760, 500);
  var contentLayer = doc.layers[0];

  addPointText(doc, contentLayer, "City council budget vote", 40, 430, {
    name: "video-title",
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 30
  });
  addAreaText(
    doc,
    contentLayer,
    "A short explainer with one usable background video and three invalid video annotations that should warn without breaking the export.",
    40,
    380,
    420,
    110,
    { name: "video-deck", fontNames: ["ArialMT", "MyriadPro-Regular"], size: 16 }
  );
  addAreaText(
    doc,
    contentLayer,
    "Residents packed the chamber as officials debated how to close a widening transportation funding gap before the end of the fiscal year.",
    40,
    270,
    340,
    90,
    { name: "video-body", fontNames: ["ArialMT", "MyriadPro-Regular"], size: 15 }
  );
  addRectangle(contentLayer, 420, 420, 280, 160, [221, 221, 221], "video-placeholder");

  var heroLayer = addLayer(doc, "hero-video:video");
  addPointText(doc, heroLayer, "https://example.com/video.mp4", 430, 350, {
    name: "hero-video-url",
    fontNames: ["ArialMT", "MyriadPro-Regular"],
    size: 12
  });

  var badExtLayer = addLayer(doc, "bad-ext:video");
  addPointText(doc, badExtLayer, "https://example.com/video.mov", 430, 320, {
    name: "bad-ext-url",
    fontNames: ["ArialMT", "MyriadPro-Regular"],
    size: 12
  });

  var badProtocolLayer = addLayer(doc, "bad-protocol:video");
  addPointText(doc, badProtocolLayer, "http://example.com/video.mp4", 430, 290, {
    name: "bad-protocol-url",
    fontNames: ["ArialMT", "MyriadPro-Regular"],
    size: 12
  });

  var blankLayer = addLayer(doc, "blank-video:video");
  addPointText(doc, blankLayer, "   ", 430, 260, {
    name: "blank-video-url",
    fontNames: ["ArialMT", "MyriadPro-Regular"],
    size: 12
  });

  saveDoc(doc, dir, "video-editorial.ai");
}

function createHtmlHooksEditorial() {
  var dir = ROOT + "/data/html-hooks-editorial";
  var doc = newDoc("html-hooks-editorial", 760, 520);
  var contentLayer = doc.layers[0];

  addPointText(doc, contentLayer, "HTML hooks editorial fixture", 40, 455, {
    name: "hooks-title",
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 28
  });
  addAreaText(
    doc,
    contentLayer,
    "This story card combines hook layers and ai2html-html blocks so the exporter has to preserve ordering around real editorial text.",
    40,
    405,
    420,
    110,
    { name: "hooks-deck", fontNames: ["ArialMT", "MyriadPro-Regular"], size: 16 }
  );
  addAreaText(
    doc,
    contentLayer,
    "Design systems often need injected promos, source labels, or newsletter boxes before and after the core graphic markup.",
    40,
    300,
    360,
    100,
    { name: "hooks-body", fontNames: ["ArialMT", "MyriadPro-Regular"], size: 15 }
  );
  addRectangle(contentLayer, 430, 420, 250, 160, [234, 234, 234], "hooks-art");

  addSpecialBlock(
    contentLayer,
    "ai2html-html-before",
    "<aside data-hook=\\"block-before\\">Newsletter signup block</aside>",
    { left: 24, top: 500 }
  );
  addSpecialBlock(
    contentLayer,
    "ai2html-html-after",
    "<footer data-hook=\\"block-after\\">Rendered source footer</footer>",
    { left: 24, top: 470 }
  );
  addSpecialBlock(
    contentLayer,
    "ai2html-html-before",
    "<div data-hook=\\"hidden-block\\">hidden block hook should not render</div>",
    { left: 24, top: 440, hidden: true }
  );

  var layerBefore = addLayer(doc, "deck-hook:html-before");
  addPointText(doc, layerBefore, "<div data-hook=\\\"layer-before\\\">Layer before hook</div>", 430, 390, {
    name: "layer-before-html",
    fontNames: ["ArialMT", "MyriadPro-Regular"],
    size: 12
  });

  var blankLayerHook = addLayer(doc, "blank-layer-hook:html-before");
  addPointText(doc, blankLayerHook, "   ", 430, 360, {
    name: "blank-layer-hook-html",
    fontNames: ["ArialMT", "MyriadPro-Regular"],
    size: 12
  });

  var layerAfter = addLayer(doc, "footer-hook:html-after");
  addPointText(doc, layerAfter, "<div data-hook=\\\"layer-after\\\">Layer after hook</div>", 430, 330, {
    name: "layer-after-html",
    fontNames: ["ArialMT", "MyriadPro-Regular"],
    size: 12
  });

  saveDoc(doc, dir, "html-hooks-editorial.ai");
}

function addStoryCard(doc, layer, left, top, index) {
  addPointText(doc, layer, "Story card " + index, left + 40, top - 40, {
    name: "story-title-" + index,
    fontNames: ["Arial-BoldMT", "ArialMT", "MyriadPro-Bold"],
    size: 26
  });
  addAreaText(
    doc,
    layer,
    "A realistic multi-artboard fixture for export and performance hardening. Card " + index + " keeps enough editorial text on the page to stress the HTML pipeline without becoming unwieldy.",
    left + 40,
    top - 90,
    320,
    120,
    { name: "story-body-" + index, fontNames: ["ArialMT", "MyriadPro-Regular"], size: 16 }
  );
  addRectangle(layer, left + 410, top - 20, 180, 120, [235, 235, 235], "story-art-" + index);
}

function createLargeStory() {
  var dir = ROOT + "/data/large-story";
  var widths = [640, 720, 800, 960, 1120, 1280];
  var height = 480;
  var gap = 48;
  var top = height;
  var doc = newDoc("large-story", widths[0], height);
  doc.artboards[0].name = "story-1:dynamic," + widths[0];

  for (var i = 1; i < 6; i++) {
    var left = 0;
    for (var j = 0; j < i; j++) {
      left += widths[j] + gap;
    }
    var mode = (i % 2 === 0) ? ":fixed," : ":dynamic,";
    addArtboard(doc, left, top, widths[i], height, "story-" + (i + 1) + mode + widths[i]);
  }

  var contentLayer = doc.layers[0];
  for (var card = 0; card < 6; card++) {
    var cardLeft = 0;
    for (var cardOffset = 0; cardOffset < card; cardOffset++) {
      cardLeft += widths[cardOffset] + gap;
    }
    addStoryCard(doc, contentLayer, cardLeft, top, card + 1);
  }

  var svgLayer = addLayer(doc, "locator:svg");
  for (var svgCard = 0; svgCard < 6; svgCard += 2) {
    var svgLeft = 0;
    for (var svgOffset = 0; svgOffset < svgCard; svgOffset++) {
      svgLeft += widths[svgOffset] + gap;
    }
    addCircle(svgLayer, svgLeft + 560, 300, 48, [38, 128, 235], "locator-" + (svgCard + 1));
  }

  var pngLayer = addLayer(doc, "highlight:png");
  for (var pngCard = 1; pngCard < 6; pngCard += 2) {
    var pngLeft = 0;
    for (var pngOffset = 0; pngOffset < pngCard; pngOffset++) {
      pngLeft += widths[pngOffset] + gap;
    }
    addRectangle(pngLayer, pngLeft + 420, 420, 180, 120, [255, 201, 40], "highlight-" + (pngCard + 1));
  }

  saveDoc(doc, dir, "large-story.ai");
}

var failures = [];

function shouldRun(name) {
  if (${JSON.stringify(requestedNames)}.length === 0) return true;
  for (var i = 0; i < ${JSON.stringify(requestedNames)}.length; i++) {
    if (${JSON.stringify(requestedNames)}[i] === name) return true;
  }
  return false;
}

function runStep(name, fn) {
  if (!shouldRun(name)) return;
  try {
    fn();
  } catch (e) {
    failures.push(name + ": " + e);
  }
}

try {
  runStep("settings-precedence", createSettingsPrecedence);
  runStep("rotated-text-real", createRotatedTextReal);
  runStep("rotated-text-image", createRotatedTextImage);
  runStep("character-styles-real", createCharacterStylesReal);
  runStep("font-mapping-real", createFontMappingReal);
  runStep("overset-text-real", createOversetTextReal);
  runStep("hyperlinks", createHyperlinks);
  runStep("accessibility", createAccessibility);
  runStep("layer-export-matrix", createLayerExportMatrix);
  runStep("video-editorial", createVideoEditorial);
  runStep("html-hooks-editorial", createHtmlHooksEditorial);
  runStep("large-story", createLargeStory);
  if (failures.length > 0) {
    throw new Error(failures.join(" | "));
  }
  "Generated Illustrator hardening fixtures";
} finally {
  if (previousInteraction !== null) {
    try {
      app.userInteractionLevel = previousInteraction;
    } catch (e) {}
  }
}
`;

writeFileSync(jsxPath, jsx, "utf-8");

try {
  execFileSync(
    "osascript",
    [
      "-e",
      'tell application "Adobe Illustrator" to activate',
      "-e",
      `with timeout of 120 seconds
        tell application "Adobe Illustrator"
          do javascript (read POSIX file "${jsxPath}")
        end tell
      end timeout`,
    ],
    { stdio: "inherit" },
  );
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
