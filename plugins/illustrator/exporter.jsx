// all2html ExtendScript Exporter for Adobe Illustrator
// This file is concatenated with the core bundle to produce dist/all2html.js
// It extracts document data into the IR format, then calls All2Html.processAndEmit()

// ============================================================
// State management
// ============================================================

var warnings = [];
// Structured mirror of `warnings`, in the same order. Every entry carries the
// stable code and the category its call site declared, plus the surface, and
// core warnings are appended verbatim from result.structuredWarnings. Nothing
// here is ever derived from message text.
var structuredWarnings = [];
// LIFO stack of restore closures. Push one at the exact moment a document
// mutation happens so restores always run in inverse order of mutation
// (e.g. an item is always unhidden before it is relocked — setting .hidden
// on a relocked item throws).
var restoreActions = [];
var unlockedObjectCount = 0;
var docToMarkSaved = null;

function logDiagnostic(level, message, detail) {
  try {
    if ($.global && typeof $.global.__ALL2HTML_LOG__ === "function") {
      $.global.__ALL2HTML_LOG__("illustrator-exporter", level, String(message), detail ? String(detail) : undefined);
    }
  } catch (e) {}
}

// code and category are assigned here, at the call site, exactly as
// src/core/warnings.ts requires. category must be one of the core
// WarningCategory values (see WARNING_CATEGORY_ORDER below).
function warn(msg, code, category) {
  warnings.push(msg);
  structuredWarnings.push({
    code: code || "illustrator:other",
    category: category || "other",
    message: msg,
    surface: "illustrator"
  });
  logDiagnostic("warn", msg);
}

// Appends the core's structured warnings verbatim, keeping the plain-string
// list in the same order.
function pushCoreWarnings(result) {
  var messages = result.warnings || [];
  for (var i = 0; i < messages.length; i++) {
    warnings.push(messages[i]);
  }
  var structured = result.structuredWarnings || [];
  for (var j = 0; j < structured.length; j++) {
    structuredWarnings.push(structured[j]);
  }
}

// ============================================================
// Document validation
// ============================================================

function validateDocument() {
  if (app.documents.length === 0) {
    throw new Error("No document is open.");
  }
  var doc = app.activeDocument;
  // Document must have a file path (either saved or opened from file)
  var hasPath = false;
  try { hasPath = !!String(doc.fullName); } catch(e) {}
  if (!hasPath) {
    try { hasPath = !!String(doc.path); } catch(e) {}
  }
  if (!hasPath) {
    throw new Error("Please save the document before running all2html.");
  }
  if (doc.documentColorSpace !== DocumentColorSpace.RGB) {
    throw new Error("Document color mode must be RGB. Change via File > Document Color Mode > RGB Color.");
  }
  if (doc.activeLayer.name === "Isolation Mode") {
    throw new Error("Exit Isolation Mode before running all2html.");
  }
  // Check for opacity mask editing
  if (doc.activeLayer.name === "<Opacity Mask>" && doc.layers.length === 1) {
    throw new Error("Cannot run while editing an Opacity Mask.");
  }
  return doc;
}

// ============================================================
// Utility functions
// ============================================================

function trim(s) {
  return s.replace(/^[\s\uFEFF\xA0\x03]+|[\s\uFEFF\xA0\x03]+$/g, "");
}

/**
 * The document's output directory, as one relative path under the .ai file.
 *
 * A named function so a test can execute the *real* one out of this file: the
 * shared constructor rejecting traversal proves nothing if this call site stops
 * calling it, and a source-level grep would not notice either. See
 * `test/unit/extendscript-setting-safety.test.ts`.
 */
function resolveDocumentOutputPath(settings, docPath) {
  // The *validated* bag, not raw docSettings: a path sanitizeCanonicalSettings had
  // rejected still chose the output directory, so the run wrote where ir.json denied.
  var rawOutputPath = settings.htmlOutputPath || settings.imageOutputPath || "all2html-output/";
  // Construct a relative filesystem directory at the boundary. This shared
  // rule rejects traversal, drive prefixes and controls, contains leading
  // slashes under the document directory, and returns one trailing slash.
  rawOutputPath = All2Html.relativeOutputDirectory(String(rawOutputPath));
  var outputPath = docPath + rawOutputPath;
  if (outputPath.charAt(outputPath.length - 1) !== "/") outputPath += "/";
  return outputPath;
}

function makeKeyword(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function makeStableId(prefix, name, index) {
  var keyword = makeKeyword(String(name || ""));
  if (!keyword) keyword = "item";
  return prefix + ":" + keyword + "-" + index;
}

function makeAssetName(parts) {
  var tokens = [];
  for (var i = 0; i < parts.length; i++) {
    var token = makeKeyword(String(parts[i] || ""));
    if (token) tokens.push(token);
  }
  return tokens.length ? tokens.join("-") : "asset";
}

function boundsIntersect(a, b) {
  // Both in AI format: [left, top, right, bottom] (top > bottom because Y is up)
  return !(a[2] < b[0] || a[0] > b[2] || a[1] < b[3] || a[3] > b[1]);
}

function objectIsHidden(obj) {
  while (obj) {
    if (obj.hidden === true || obj.visible === false) return true;
    obj = obj.parent;
    if (!obj || obj.typename === "Document") break;
  }
  return false;
}

function computeOpacity(obj) {
  var opacity = 100;
  while (obj) {
    if (typeof obj.opacity === "number") {
      opacity = opacity * obj.opacity / 100;
    }
    obj = obj.parent;
    if (!obj || obj.typename === "Document") break;
  }
  return Math.round(opacity);
}

function getBlendMode(obj) {
  while (obj) {
    if (obj.blendingMode && obj.blendingMode === BlendModes.MULTIPLY) {
      return "multiply";
    }
    obj = obj.parent;
    if (!obj || obj.typename === "Document") break;
  }
  return undefined;
}

function straightenCurlyQuotes(str) {
  return str
    .replace(/\u201C/g, '"').replace(/\u201D/g, '"')
    .replace(/\u2018/g, "'").replace(/\u2019/g, "'");
}

function straightenCurlyQuotesInAngleBrackets(str) {
  return str.replace(/<[^>]*>/g, function(tag) {
    return straightenCurlyQuotes(tag);
  });
}

// ============================================================
// Locked object handling
// ============================================================

function unlockObjects(doc) {
  function unlockContainer(o) {
    if (o.hidden === true || o.visible === false) return;
    if (o.locked) {
      o.locked = false;
      unlockedObjectCount++;
      pushRelockRestore(o);
    }
    // Unlock clipping paths
    var pathCount = 0;
    try { pathCount = o.pathItems.length; } catch(e) {}
    if ((o.typename === "Layer" && pathCount < 500) ||
        (o.typename === "GroupItem" && o.clipped)) {
      for (var i = 0; i < pathCount; i++) {
        try {
          var item = o.pathItems[i];
          if (!item.hidden && item.clipping && item.locked) {
            item.locked = false;
            unlockedObjectCount++;
            pushRelockRestore(item);
            break;
          }
        } catch(e) {}
      }
    }
    // Recurse
    try {
      for (var j = 0; j < o.groupItems.length; j++) {
        unlockContainer(o.groupItems[j]);
      }
    } catch(e) {}
    if (o.typename === "Layer") {
      try {
        for (var k = 0; k < o.layers.length; k++) {
          unlockContainer(o.layers[k]);
        }
      } catch(e) {}
    }
  }
  for (var i = 0; i < doc.layers.length; i++) {
    unlockContainer(doc.layers[i]);
  }
}

// Save-for-Web asks the host to interact with the user before writing each
// file. Driven over AppleEvents nothing answers, so every exportFile() blocked
// for the full ~120s interaction timeout. Suppressing alerts removes the
// handshake. Restore is pushed first so it runs last: cleanup stays
// non-interactive, and the level is back before any completion dialog.
//
// The observed level is never trusted as "previous" when it is already
// suppressed. A run that dies between suppression and runRestoreActions()
// (cancelled script, host crash) leaves DONTDISPLAYALERTS in place; the next run
// would then read the suppressed value as the level to restore and pin
// Illustrator to auto-answered dialogs for the rest of the session. Restoring to
// DISPLAYALERTS is the only self-healing choice.
function suppressUserInteraction() {
  try {
    var previousLevel = app.userInteractionLevel;
    if (previousLevel === UserInteractionLevel.DONTDISPLAYALERTS) {
      previousLevel = UserInteractionLevel.DISPLAYALERTS;
    }
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    pushInteractionLevelRestore(previousLevel);
  } catch(e) {}
}

function pushInteractionLevelRestore(previousLevel) {
  restoreActions.push(function() { app.userInteractionLevel = previousLevel; });
}

// Restore helpers. Each pusher is a separate function so the captured item is
// bound per call (ExtendScript has no block scope).
function pushRelockRestore(item) {
  restoreActions.push(function() { item.locked = true; });
}

function pushUnhideRestore(item) {
  restoreActions.push(function() { item.hidden = false; });
}

// Runs every pending restore in LIFO order and returns how many failed.
// Failures are warned rather than swallowed — a failed restore leaves the
// user's .ai file mutated (e.g. a permanently hidden all2html-settings block) —
// and the count is what stops executeAll2Html from marking it saved.
function runRestoreActions() {
  var failures = 0;
  while (restoreActions.length > 0) {
    var action = restoreActions.pop();
    try {
      action();
    } catch(e) {
      failures++;
      warn("Could not restore document state after export: " + (e.message || e.toString()) + " The document was left modified and is not marked saved.", "illustrator:restore-failed", "other");
    }
  }
  return failures;
}

// ============================================================
// Settings + custom block parsing
// ============================================================

// Block/layer names are recognized under `all2html-` first, with `ai2html-` as a
// compatibility alias. INPUT names only — emitted classes/markers are unaffected.
// Precedence when a document carries both: `all2html-` wins key-by-key over
// `ai2html-`. Custom code blocks do not conflict, so both are kept in doc order.
var LEGACY_BLOCK_PREFIX = "ai2html-";
var SPECIAL_BLOCK_PREFIXES = ["all2html-", LEGACY_BLOCK_PREFIX];
var SPECIAL_BLOCK_RXP = /^(all2html|ai2html)-(css|js|html|settings|text|html-before|html-after)\s*$/;
var SPECIAL_NAME_RXP = /^(all2html|ai2html)-/;
var SETTINGS_BLOCK_RXP = /^(all2html|ai2html)-settings\s*$/;

function parseSpecialBlocks(doc) {
  var settings = {};
  var legacySettings = {};
  var customBlocks = [];

  for (var i = 0; i < doc.textFrames.length; i++) {
    var tf = doc.textFrames[i];
    var firstLine;
    try {
      if (tf.lines.length < 1) continue;
      firstLine = tf.lines[0].contents;
    } catch(e) { continue; }

    var match = SPECIAL_BLOCK_RXP.exec(firstLine);
    if (!match) continue;
    var prefix = match[1] + "-";
    var blockType = match[2];
    var blockName = prefix + blockType;

    if (objectIsHidden(tf)) {
      if (blockType === "settings") {
        throw new Error("Found a hidden " + blockName + " text block. Please unhide it.");
      }
      warn("Skipping hidden " + blockName + " block.", "block:hidden", "markup");
      continue;
    }

    var lines = tf.contents.split(/[\r\n]/);
    lines.shift(); // remove header line

    if (blockType === "settings" || blockType === "text") {
      // Legacy keys land in their own bag and are merged underneath at return,
      // so cross-prefix precedence does not depend on text-frame order. Within a
      // prefix it does: duplicates assign into one bag, so the last one wins.
      // panel-settings-block.test.ts holds the panel's merge to both halves.
      var bag = prefix === LEGACY_BLOCK_PREFIX ? legacySettings : settings;
      // Parse key: value entries
      for (var j = 0; j < lines.length; j++) {
        var line = trim(lines[j]);
        var entryMatch = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
        if (entryMatch) {
          bag[entryMatch[1]] = straightenCurlyQuotesInAngleBrackets(entryMatch[2]);
        }
      }
      if (blockType === "settings") {
        tf.name = blockName; // keep the user's own spelling
      }
    } else {
      // Custom code block
      var content = lines.join("\r");
      if (blockType === "css") {
        content = straightenCurlyQuotes(content);
        content = content.replace(/<\/?style[^>]*>/gi, "");
      } else if (blockType === "js") {
        content = straightenCurlyQuotes(content);
      } else {
        content = straightenCurlyQuotesInAngleBrackets(content);
      }
      if (!trim(content)) {
        warn("Skipping empty " + blockName + " block.", "block:empty", "markup");
        continue;
      }
      customBlocks.push({ type: blockType, content: content });
    }

    // Hide block if it overlaps an artboard
    if (blockOverlapsArtboard(doc, tf)) {
      if (tf.locked) {
        tf.locked = false;
        unlockedObjectCount++;
        pushRelockRestore(tf);
      }
      tf.hidden = true;
      pushUnhideRestore(tf);
    }
  }
  // `all2html-` wins key-by-key over the legacy `ai2html-` spelling.
  for (var k in legacySettings) {
    if (hasOwn(legacySettings, k) && !hasOwn(settings, k)) {
      settings[k] = legacySettings[k];
    }
  }
  return { settings: settings, customBlocks: customBlocks };
}

// parseSpecialBlocks names the frame with whichever spelling the user typed.
function findSettingsTextFrame(doc) {
  for (var i = 0; i < SPECIAL_BLOCK_PREFIXES.length; i++) {
    try {
      return doc.textFrames.getByName(SPECIAL_BLOCK_PREFIXES[i] + "settings");
    } catch(e) {}
  }
  return null;
}

function blockOverlapsArtboard(doc, tf) {
  var tfBounds = tf.visibleBounds;
  for (var i = 0; i < doc.artboards.length; i++) {
    if (boundsIntersect(tfBounds, doc.artboards[i].artboardRect)) {
      return true;
    }
  }
  return false;
}

// ============================================================
// Artboard enumeration
// ============================================================

function parseArtboardName(rawName) {
  var name = rawName;
  var artboardSettings = {};

  // Strip " copy" / " copy 2" suffix
  var colonIdx = name.indexOf(":");
  if (colonIdx >= 0) {
    var settingsStr = name.substring(colonIdx + 1).replace(/ copy.*/i, "");
    name = name.substring(0, colonIdx);
    // Parse comma-delimited settings
    var parts = settingsStr.split(",");
    for (var i = 0; i < parts.length; i++) {
      var part = trim(parts[i]);
      if (!part) continue;
      var eqIdx = part.indexOf("=");
      if (eqIdx >= 0) {
        artboardSettings[part.substring(0, eqIdx)] = part.substring(eqIdx + 1);
      } else if (/^\d+$/.test(part)) {
        artboardSettings.width = parseInt(part, 10);
      } else {
        artboardSettings[part] = true;
      }
    }
  } else {
    name = name.replace(/ copy.*/i, "");
  }

  return { name: trim(name), settings: artboardSettings };
}

function extractArtboards(doc) {
  var artboards = [];
  for (var i = 0; i < doc.artboards.length; i++) {
    var ab = doc.artboards[i];
    var rawName = ab.name;

    // Skip artboards starting with "-"
    if (rawName.charAt(0) === "-") continue;

    var parsed = parseArtboardName(rawName);
    var rect = ab.artboardRect; // [left, top, right, bottom]
    var actualWidth = Math.round(rect[2] - rect[0]);
    var actualHeight = Math.round(rect[1] - rect[3]); // top - bottom (top > bottom)

    var artboardObj = {
      id: makeStableId("illustrator:artboard", rawName, i + 1),
      name: parsed.name,
      width: parsed.settings.width || actualWidth,
      height: actualHeight,
      source: {
        tool: "illustrator",
        name: rawName,
        width: actualWidth,
        height: actualHeight
      },
      actualWidth: actualWidth,
      actualHeight: actualHeight,
      _aiIndex: i,
      _aiRect: rect,
      layers: []
    };

    if (parsed.settings.dynamic) artboardObj.responsiveness = "dynamic";
    if (parsed.settings.fixed) artboardObj.responsiveness = "fixed";
    if (parsed.settings.image_only) artboardObj.imageOnly = true;

    artboards.push(artboardObj);
  }
  return artboards;
}

// ============================================================
// Layer extraction
// ============================================================

function extractLayers(doc) {
  var layers = [];
  for (var i = 0; i < doc.layers.length; i++) {
    var layer = doc.layers[i];
    if (SETTINGS_BLOCK_RXP.test(layer.name)) continue;

    var parsedName = layer.name;
    var layerType = "default";
    var inlineSvg = false;

    var colonIdx = parsedName.indexOf(":");
    if (colonIdx >= 0) {
      var tag = parsedName.substring(colonIdx + 1).toLowerCase();
      parsedName = parsedName.substring(0, colonIdx);
      if (tag === "svg") layerType = "svg";
      else if (tag === "svg,inline" || tag === "inline") { layerType = "svg"; inlineSvg = true; }
      else if (tag === "png") layerType = "png";
      else if (tag === "symbol") layerType = "symbol";
      else if (tag === "div") layerType = "div";
      else if (tag === "video") layerType = "video";
      else if (tag === "html-before") layerType = "html-before";
      else if (tag === "html-after") layerType = "html-after";
    }

    var layerRecord = {
      name: trim(parsedName),
      type: layerType,
      source: {
        tool: "illustrator",
        name: layer.name
      },
      visible: layer.visible,
      // 0 is a real opacity; default only on absence (matches computeOpacity).
      opacity: typeof layer.opacity === "number" ? layer.opacity : 100,
      elements: [],
      _aiLayer: layer
    };
    // Only `true` means anything: absent is "external svg asset", and the
    // schema rejects the key on non-svg layers, so `inlineSvg: false` is noise.
    if (inlineSvg) layerRecord.inlineSvg = true;
    layers.push(layerRecord);
  }
  return layers;
}

// Clipping-mask filtering: not implemented. Masked text still exports. The
// uncalled findClippedTextFrames/isClippedFrame helpers were removed here
// rather than wired: they excluded every text frame in a clipping group, not
// just the clipped ones, and did it by selecting and locking every mask in the
// document. A real filter belongs in extractTextFramesForArtboard's loop,
// comparing visibleBounds against the mask path the way boundsIntersect
// already compares against artboards. See PROGRESS.md, "Known Limitations".

// ============================================================
// Text frame extraction
// ============================================================

function isSpecialBlock(tf) {
  try {
    var first = tf.lines[0].contents;
    return SPECIAL_NAME_RXP.test(first);
  } catch(e) {
    return false;
  }
}

function getValign(tf) {
  try {
    var note = tf.note || "";
    var match = /valign\s*[:=]\s*(top|middle|center|bottom)/i.exec(note);
    if (match) {
      var v = match[1].toLowerCase();
      return v === "center" ? "middle" : v;
    }
  } catch(e) {}
  return tf.kind === TextType.POINTTEXT ? "middle" : "top";
}

function convertColor(c) {
  try {
    if (c.typename === "RGBColor") {
      return { r: Math.round(c.red), g: Math.round(c.green), b: Math.round(c.blue) };
    }
    if (c.typename === "SpotColor") {
      return convertColor(c.spot.color);
    }
    if (c.typename === "GrayColor") {
      var v = Math.round((100 - c.gray) / 100 * 255);
      return { r: v, g: v, b: v };
    }
    if (c.typename === "NoColor") {
      warn("Found a text element with no fill color. Using green as placeholder.", "text:no-fill", "text");
      return { r: 0, g: 255, b: 0 };
    }
  } catch(e) {}
  return { r: 0, g: 0, b: 0 };
}

function mapJustification(j) {
  var s = String(j);
  if (s.indexOf("RIGHT") >= 0) return "right";
  if (s.indexOf("CENTER") >= 0) return "center";
  if (s.indexOf("JUSTIFY") >= 0 || s.indexOf("FULL") >= 0) return "justify";
  return "left";
}

function mapCapitalization(c) {
  var s = String(c);
  if (s.indexOf("ALLCAPS") >= 0) return "allcaps";
  if (s.indexOf("SMALLCAPS") >= 0) return "smallcaps";
  return "normal";
}

function mapBaselineShift(bp) {
  if (bp === FontBaselineOption.SUPERSCRIPT) return "superscript";
  if (bp === FontBaselineOption.SUBSCRIPT) return "subscript";
  return "normal";
}

function readCharStyle(ch) {
  var ca = ch.characterAttributes;
  return {
    fontName: ca.textFont.name,
    fontSize: Math.round(ca.size * 100) / 100,
    color: convertColor(ca.fillColor),
    letterSpacing: (ca.tracking || 0) / 1000,
    capitalization: mapCapitalization(ca.capitalization),
    baselineShift: mapBaselineShift(ca.baselinePosition)
  };
}

function stylesEqual(a, b) {
  return a.fontName === b.fontName &&
    a.fontSize === b.fontSize &&
    a.color.r === b.color.r && a.color.g === b.color.g && a.color.b === b.color.b &&
    a.letterSpacing === b.letterSpacing &&
    a.capitalization === b.capitalization &&
    a.baselineShift === b.baselineShift;
}

function extractParagraph(para) {
  var result = {
    text: para.contents,
    alignment: mapJustification(para.justification),
    leading: 18,
    spaceBefore: 0,
    spaceAfter: 0,
    runs: []
  };

  if (para.characters.length === 0) {
    result.text = "";
    result.runs = [{
      text: "", fontName: "ArialMT", fontSize: 12,
      color: { r: 0, g: 0, b: 0 }, letterSpacing: 0,
      capitalization: "normal", baselineShift: "normal"
    }];
    return result;
  }

  // Read paragraph-level attributes from first character
  try {
    var firstCA = para.characters[0].characterAttributes;
    var leadingVal = firstCA.leading;
    if (typeof leadingVal === "number" && !isNaN(leadingVal) && leadingVal > 0) {
      result.leading = Math.round(leadingVal * 100) / 100;
    }
    // else: keep default 18
  } catch(e) {}
  try { result.spaceBefore = Math.round(para.spaceBefore) || 0; } catch(e) {}
  try { result.spaceAfter = Math.round(para.spaceAfter) || 0; } catch(e) {}

  // Scan for character style changes
  var currentStyle = readCharStyle(para.characters[0]);
  var runStart = 0;

  for (var i = 1; i < para.characters.length; i++) {
    var charStyle = readCharStyle(para.characters[i]);
    if (!stylesEqual(currentStyle, charStyle)) {
      result.runs.push({
        text: para.contents.substring(runStart, i),
        fontName: currentStyle.fontName,
        fontSize: currentStyle.fontSize,
        color: currentStyle.color,
        letterSpacing: currentStyle.letterSpacing,
        capitalization: currentStyle.capitalization,
        baselineShift: currentStyle.baselineShift
      });
      currentStyle = charStyle;
      runStart = i;
    }
  }
  // Final run
  result.runs.push({
    text: para.contents.substring(runStart),
    fontName: currentStyle.fontName,
    fontSize: currentStyle.fontSize,
    color: currentStyle.color,
    letterSpacing: currentStyle.letterSpacing,
    capitalization: currentStyle.capitalization,
    baselineShift: currentStyle.baselineShift
  });

  return result;
}

// Rotation detected from the frame's matrix. Callable both at element
// extraction and at raster-export time (hideTextFramesForExport) with the
// same result: it reads only the frame, never mutable export state.
function computeTextFrameRotation(tf) {
  var rotation = { angle: 0, matrix: null };
  try {
    var m = tf.matrix;
    var angle = Math.atan2(m.mValueB, m.mValueA) * (180 / Math.PI);
    if (Math.abs(angle) > 1) {
      rotation.angle = angle;
      rotation.matrix = [
        m.mValueA, m.mValueB, m.mValueC, m.mValueD, m.mValueTX, m.mValueTY
      ];
    }
  } catch(e) {}
  return rotation;
}

// The ONE renderAs disposition, shared by element extraction and
// hideTextFramesForExport. Whatever sets renderAs "image" on a frame's
// element must also keep that frame visible during raster export —
// otherwise the text appears in neither the HTML nor the raster.
// Precedence: imageOnly > global setting > rotation setting > html.
function decideTextFrameRenderAs(tf, artboard, settings, rotation) {
  if (rotation === undefined || rotation === null) {
    rotation = computeTextFrameRotation(tf);
  }
  if (artboard.imageOnly) return { renderAs: "image", reason: "imageOnly" };
  if (settings.renderTextAs === "image") return { renderAs: "image", reason: "setting" };
  if (rotation.angle !== 0 && settings.renderRotatedSkewedTextAs === "image") {
    return { renderAs: "image", reason: "rotation" };
  }
  return { renderAs: "html", reason: undefined };
}

function extractTextFramesForArtboard(doc, artboard, layers, settings) {
  var abRect = artboard._aiRect;
  var abLeft = abRect[0];
  var abTop = abRect[1];
  var frames = [];

  for (var i = 0; i < doc.textFrames.length; i++) {
    var tf = doc.textFrames[i];
    if (tf.kind === TextType.PATHTEXT) continue;
    if (objectIsHidden(tf)) continue;
    if (tf.contents.length === 0) continue;
    if (isSpecialBlock(tf)) continue;
    if (!boundsIntersect(tf.visibleBounds, abRect)) continue;
    // Skip metadata text frames on special layers:
    // - :video layers have text frames containing .mp4 URLs (not display text)
    // - :html-before/:html-after layers have raw HTML content (not display text)
    // But text on :svg/:symbol/:div/:png layers IS display text and should be extracted
    try {
      var layerName = tf.layer.name;
      var colonIdx = layerName.indexOf(":");
      if (colonIdx >= 0) {
        var tag = layerName.substring(colonIdx + 1).toLowerCase();
        if (tag === "video" || tag === "html-before" || tag === "html-after") continue;
      }
    } catch(e) {}
    frames.push(tf);
  }

  // Sort top-to-bottom, left-to-right
  frames.sort(function(a, b) {
    var dy = b.top - a.top;
    if (Math.abs(dy) > 1) return dy > 0 ? -1 : 1;
    return a.left - b.left;
  });

  // Find the default layer to add elements to. Prefer a visible default
  // layer, then an invisible default layer (warned below): the emitter
  // renders text only on `default`-type layers, so a visible `:div`/`:png`
  // layer is NOT a better home than an invisible default — text attached
  // there vanishes with no visibility warning to explain it. Tagged layers
  // are a last resort only, and that attach warns too.
  var defaultLayer = null;
  for (var li = 0; li < layers.length; li++) {
    if (layers[li].type === "default" && layers[li].visible) {
      defaultLayer = layers[li];
      break;
    }
  }
  if (!defaultLayer) {
    for (var ld = 0; ld < layers.length; ld++) {
      if (layers[ld].type === "default") {
        defaultLayer = layers[ld];
        break;
      }
    }
  }
  if (!defaultLayer && layers.length > 0) {
    defaultLayer = layers[0];
  }
  var warnedInvisibleLayer = false;
  var warnedUnrenderableLayer = false;

  var abIndex = artboard._aiIndex;
  // Element ids already used on THIS artboard. Two frames with the same name
  // on one artboard would otherwise emit the same DOM id; keys are $-prefixed
  // so a frame named "constructor" cannot collide with Object.prototype.
  var usedElementIds = {};
  for (var fi = 0; fi < frames.length; fi++) {
    var tf = frames[fi];
    var rotation = computeTextFrameRotation(tf);
    // Shared with hideTextFramesForExport: see decideTextFrameRenderAs.
    var disposition = decideTextFrameRenderAs(tf, artboard, settings, rotation);
    var renderAs = disposition.renderAs;
    var renderAsReason = disposition.reason;

    var baseId = tf.name ? makeKeyword(tf.name) : ("g-ai" + abIndex + "-" + (fi + 1));
    var elementId = baseId;
    var dedupeIndex = 2;
    while (hasOwn(usedElementIds, "$" + elementId)) {
      elementId = baseId + "-" + dedupeIndex;
      dedupeIndex++;
    }
    if (elementId !== baseId) {
      warn('Duplicate text frame name "' + (tf.name || baseId) + '" on artboard "' + artboard.name + '". Using id "' + elementId + '" for this frame.', "text:duplicate-id", "text");
    }
    usedElementIds["$" + elementId] = true;

    var element = {
      type: "text",
      id: elementId,
      kind: tf.kind === TextType.POINTTEXT ? "point" : "area",
      position: {
        x: tf.left - abLeft,
        y: abTop - tf.top,
        width: tf.width,
        height: Math.abs(tf.height)
      },
      opacity: computeOpacity(tf),
      valign: getValign(tf),
      renderAs: renderAs,
      paragraphs: []
    };
    if (renderAsReason) element.renderAsReason = renderAsReason;

    // Blend mode
    var blend = getBlendMode(tf);
    if (blend) element.blendMode = blend;

    // Apply rotation
    if (rotation.matrix) {
      element.rotation = rotation.angle;
      element.transformMatrix = rotation.matrix;
    }

    // Extract paragraphs
    var charsLeft = tf.characters.length;
    for (var p = 0; p < tf.paragraphs.length && charsLeft > 0; p++) {
      try {
        var para = tf.paragraphs[p];
        var pLen = para.characters.length;
        element.paragraphs.push(extractParagraph(para));
        charsLeft -= (pLen + 1);
      } catch(e) {
        break;
      }
    }

    // Check for overset text
    if (checkOversetText(tf)) {
      warn("Overset text detected in frame \"" + (tf.name || element.id) + "\". Hidden text will appear in HTML output.", "text:overset", "text");
    }

    if (element.paragraphs.length > 0 && defaultLayer) {
      if (defaultLayer.visible === false && !warnedInvisibleLayer) {
        warn('Text on artboard "' + artboard.name + '" was attached to invisible layer "' + defaultLayer.name + '" because no visible default layer exists. It will not appear in the HTML output; show the layer to export it.', "layer:invisible-content", "text");
        warnedInvisibleLayer = true;
      }
      if (defaultLayer.type !== "default" && !warnedUnrenderableLayer) {
        warn('Text on artboard "' + artboard.name + '" was attached to special layer "' + defaultLayer.name + '" because no default layer exists. The HTML output renders text only on plain layers, so it will not appear; add an untagged layer for text.', "layer:unrenderable-content", "text");
        warnedUnrenderableLayer = true;
      }
      defaultLayer.elements.push(element);
    }
  }
}

// ============================================================
// Layer content extraction (SVG, PNG, symbols, video, html)
// ============================================================

function extractLayerContent(doc, artboard, layers, settings, assets) {
  var abRect = artboard._aiRect;
  var abLeft = abRect[0], abTop = abRect[1];
  var slug = settings.projectName;

  for (var li = 0; li < layers.length; li++) {
    var layer = layers[li];
    if (!layer.visible) continue;
    var aiLayer = findAiLayerByName(doc, layer.name, layer.type);
    if (!aiLayer) continue;

    // Video layer: find text frame with .mp4 URL
    if (layer.type === "video") {
      try {
        var validVideoFound = false;
        for (var ti = 0; ti < aiLayer.textFrames.length; ti++) {
          var url = aiLayer.textFrames[ti].contents.replace(/^\s+|\s+$/g, "");
          if (url.indexOf("https") === 0 && /\.mp4(?:$|[?#])/i.test(url)) {
            layer.elements.push({ type: "video", url: url });
            validVideoFound = true;
            break;
          }
        }
        if (!validVideoFound) {
          warn('Layer "' + layer.name + '" tagged :video does not contain a usable HTTPS .mp4 URL.', "video:invalid-url", "markup");
        }
      } catch(e) {}
    }

    // HTML before/after layers: extract text content
    if (layer.type === "html-before" || layer.type === "html-after") {
      try {
        var htmlContentFound = false;
        for (var ti = 0; ti < aiLayer.textFrames.length; ti++) {
          var content = trim(aiLayer.textFrames[ti].contents || "");
          if (content) {
            htmlContentFound = true;
            layer.elements.push({ type: "rawHtml", content: straightenCurlyQuotesInAngleBrackets(content) });
          }
        }
        if (!htmlContentFound) {
          warn('Layer "' + layer.name + '" tagged :' + layer.type + " has no usable HTML content.", "html-hook:empty", "markup");
        }
      } catch(e) {}
    }

    // Symbol/div layers: detect shapes
    if (layer.type === "symbol" || layer.type === "div") {
      try {
        extractShapesFromLayer(aiLayer, layer, abRect);
      } catch(e) {
        warn("Shape detection failed on layer \"" + layer.name + "\": " + e.message, "shape:detection-failed", "geometry");
      }
    }

    // SVG layers: export as SVG file or inline
    if (layer.type === "svg") {
      try {
        // The asset id IS the filename base, computed once and passed down —
        // exportSvgLayer deriving its own name from artboard.name while this
        // record used source.name is how HTML references and written files
        // diverged on suffixed artboard names (large-story regression).
        var svgAssetId = makeAssetName([
          slug,
          artboard.source && artboard.source.name ? artboard.source.name : artboard.name,
          layer.name
        ]);
        if (assets[svgAssetId]) {
          svgAssetId = makeAssetName([svgAssetId, layer.id]);
        }
        var svgResult = exportSvgLayer(doc, aiLayer, artboard, layer, svgAssetId, settings);
        if (svgResult) {
          if (layer.inlineSvg && svgResult.content) {
            layer.elements.push({ type: "rawHtml", content: svgResult.content });
          } else if (svgResult.path) {
            assets[svgAssetId] = {
              id: svgAssetId,
              path: svgAssetId + ".svg",
              mimeType: "image/svg+xml",
              width: artboard.actualWidth,
              height: artboard.actualHeight,
              artboardId: artboard.id,
              layerId: layer.id,
              source: {
                tool: "illustrator",
                name: layer.name
              },
              exportParams: { format: "svg", scale: 1 }
            };
          }
        }
      } catch(e) {
        warn("SVG export failed on layer \"" + layer.name + "\": " + e.message, "image:svg-export-failed", "image");
      }
    }

    // PNG layers: export as transparent PNG
    if (layer.type === "png") {
      try {
        var pngAssetId = makeAssetName([
          slug,
          artboard.source && artboard.source.name ? artboard.source.name : artboard.name,
          layer.name
        ]);
        if (assets[pngAssetId]) {
          pngAssetId = makeAssetName([pngAssetId, layer.id]);
        }
        exportPngLayer(doc, aiLayer, artboard, pngAssetId, settings);
        assets[pngAssetId] = {
          id: pngAssetId,
          path: pngAssetId + ".png",
          mimeType: "image/png",
          width: artboard.actualWidth * (settings.use2xImages ? 2 : 1),
          height: artboard.actualHeight * (settings.use2xImages ? 2 : 1),
          artboardId: artboard.id,
          layerId: layer.id,
          source: {
            tool: "illustrator",
            name: layer.name
          },
          exportParams: { format: "png", scale: settings.use2xImages ? 2 : 1, transparent: true }
        };
      } catch(e) {
        warn("PNG layer export failed on layer \"" + layer.name + "\": " + e.message, "image:png-export-failed", "image");
      }
    }
  }
}

function findAiLayerByName(doc, name, type) {
  // Find the Illustrator layer that matches our parsed layer name + type
  var fullName = name;
  if (type !== "default") {
    // Try with annotation suffix
    var suffixes = {
      "svg": ":svg", "png": ":png", "symbol": ":symbol", "div": ":div",
      "video": ":video", "html-before": ":html-before", "html-after": ":html-after"
    };
    fullName = name + (suffixes[type] || "");
  }
  for (var i = 0; i < doc.layers.length; i++) {
    var l = doc.layers[i];
    if (l.name === fullName) return l;
    // Check with inline modifier
    if (type === "svg" && (l.name === name + ":svg,inline" || l.name === name + ":inline")) return l;
    // Only fall back to bare name for default layers (typed layers must have suffix)
    if (type === "default" && l.name === name) return l;
  }
  return null;
}

function extractShapesFromLayer(aiLayer, irLayer, abRect) {
  var abLeft = abRect[0], abTop = abRect[1];

  function processItem(item) {
    if (item.hidden) return;
    if (item.typename === "PathItem") {
      var shape = detectShape(item, abLeft, abTop);
      if (shape) irLayer.elements.push(shape);
    }
    if (item.typename === "GroupItem") {
      for (var i = 0; i < item.pageItems.length; i++) {
        processItem(item.pageItems[i]);
      }
    }
  }

  for (var i = 0; i < aiLayer.pageItems.length; i++) {
    processItem(aiLayer.pageItems[i]);
  }
}

function detectShape(pathItem, abLeft, abTop) {
  var pts = pathItem.pathPoints;
  var bounds = pathItem.visibleBounds;
  var x = bounds[0] - abLeft;
  var y = abTop - bounds[1];
  var w = bounds[2] - bounds[0];
  var h = bounds[1] - bounds[3];

  var shape = {
    type: "shape",
    position: { x: x, y: y, width: w, height: h },
    opacity: computeOpacity(pathItem)
  };

  if (pathItem.name) shape.id = makeKeyword(pathItem.name);

  // Fill
  if (pathItem.filled) {
    var fc = pathItem.fillColor;
    try {
      shape.fill = convertColor(fc);
    } catch(e) {}
  }

  // Stroke
  if (pathItem.stroked && pathItem.strokeWidth > 0) {
    try {
      shape.stroke = { width: pathItem.strokeWidth, color: convertColor(pathItem.strokeColor) };
    } catch(e) {}
  }

  // Blend mode
  var blend = getBlendMode(pathItem);
  if (blend) shape.blendMode = blend;

  // Detect type
  if (pts.length === 4 && isSmooth(pts)) {
    shape.shapeType = "circle";
    return shape;
  }
  if ((pts.length === 4 || pts.length === 5) && isCorners(pts, bounds)) {
    shape.shapeType = "rectangle";
    return shape;
  }
  if (!pathItem.closed && pathItem.stroked && isOrthogonal(pts)) {
    shape.shapeType = "line";
    shape.orientation = (h < w) ? "horizontal" : "vertical";
    return shape;
  }

  return null; // Unrecognized shape
}

function isSmooth(pts) {
  for (var i = 0; i < pts.length; i++) {
    if (pts[i].pointType !== PointType.SMOOTH) return false;
  }
  return true;
}

function isCorners(pts, bounds) {
  var left = bounds[0], top = bounds[1], right = bounds[2], bottom = bounds[3];
  var tolerance = 0.5;
  for (var i = 0; i < Math.min(pts.length, 4); i++) {
    var ax = pts[i].anchor[0], ay = pts[i].anchor[1];
    var onEdge = (Math.abs(ax - left) < tolerance || Math.abs(ax - right) < tolerance) &&
                 (Math.abs(ay - top) < tolerance || Math.abs(ay - bottom) < tolerance);
    if (!onEdge) return false;
  }
  return true;
}

function isOrthogonal(pts) {
  for (var i = 1; i < pts.length; i++) {
    var dx = Math.abs(pts[i].anchor[0] - pts[i-1].anchor[0]);
    var dy = Math.abs(pts[i].anchor[1] - pts[i-1].anchor[1]);
    if (dx > 0.5 && dy > 0.5) return false; // Diagonal segment
  }
  return true;
}

// Reading `.name` off a layer whose restore just failed can throw too, so the
// name is only ever fetched defensively, for the warning message.
function describeLayer(layer) {
  try {
    return "\"" + layer.name + "\"";
  } catch(e) {
    return "(unnamed)";
  }
}

function exportSvgLayer(doc, aiLayer, artboard, irLayer, assetId, settings) {
  // Hide all layers except this one, export artboard as SVG
  var hiddenLayers = [];
  for (var i = 0; i < doc.layers.length; i++) {
    var l = doc.layers[i];
    if (l !== aiLayer && l.visible) {
      l.visible = false;
      hiddenLayers.push(l);
    }
  }

  try {
    doc.artboards.setActiveArtboardIndex(artboard._aiIndex);
    var outputPath = settings.outputPath;
    ensureFolder(outputPath);
    // The caller's asset record points at assetId + ".svg"; writing any other
    // name ships HTML that references a file that does not exist.
    var svgName = assetId;
    var svgFile = new File(outputPath + svgName + ".svg");

    var opts = new ExportOptionsSVG();
    opts.embedAllFonts = false;
    opts.embedRasterImages = settings.svgEmbedImages === true;
    opts.fontSubsetting = SVGFontSubsetting.None;
    opts.compressed = false;
    opts.DTD = SVGDTDVersion.SVGTINY1_2;
    opts.cssProperties = SVGCSSPropertyLocation.STYLEATTRIBUTES;
    opts.artBoardClipping = true;

    doc.exportFile(svgFile, ExportType.SVG, opts);

    // Read SVG content if inline
    if (irLayer.inlineSvg) {
      var f = new File(outputPath + svgName + ".svg");
      if (f.exists) {
        f.open("r");
        f.encoding = "UTF-8";
        var content = f.read();
        f.close();
        return { content: content };
      }
    }

    return { path: svgName + ".svg" };
  } finally {
    // Restore hidden layers. This function hid every other layer in the
    // document, so a swallowed failure leaves the user's .ai file with layers
    // permanently invisible while the export still reports success.
    for (var i = 0; i < hiddenLayers.length; i++) {
      try {
        hiddenLayers[i].visible = true;
      } catch(e) {
        warn("Could not restore layer " + describeLayer(hiddenLayers[i]) + " after SVG layer export: " + (e.message || e.toString()), "illustrator:restore-failed", "other");
      }
    }
  }
}

function exportPngLayer(doc, aiLayer, artboard, assetId, settings) {
  // Hide all layers except this one, export as transparent PNG
  var hiddenLayers = [];
  for (var i = 0; i < doc.layers.length; i++) {
    var l = doc.layers[i];
    if (l !== aiLayer && l.visible) {
      l.visible = false;
      hiddenLayers.push(l);
    }
  }

  try {
    doc.artboards.setActiveArtboardIndex(artboard._aiIndex);
    var outputPath = settings.outputPath;
    ensureFolder(outputPath);
    var file = new File(outputPath + assetId);
    var scale = settings.use2xImages ? 200 : 100;

    var opts = new ExportOptionsPNG8();
    opts.artBoardClipping = true;
    opts.antiAliasing = false;
    opts.horizontalScale = scale;
    opts.verticalScale = scale;
    opts.transparency = true;
    opts.colorCount = 256;
    doc.exportFile(file, ExportType.PNG8, opts);
  } finally {
    // Same contract as exportSvgLayer: every other layer was hidden, so a
    // silent restore failure permanently blanks the user's document.
    for (var i = 0; i < hiddenLayers.length; i++) {
      try {
        hiddenLayers[i].visible = true;
      } catch(e) {
        warn("Could not restore layer " + describeLayer(hiddenLayers[i]) + " after PNG layer export: " + (e.message || e.toString()), "illustrator:restore-failed", "other");
      }
    }
  }
}

// ============================================================
// Image export
// ============================================================

function resolveImageFormat(doc, artboard, settings) {
  // If user explicitly set a non-auto format, honor it
  var formats = settings.imageFormat;
  if (formats && formats.length > 0 && formats[0] !== "auto") {
    return formats[0]; // Use first specified format
  }
  // Auto: check for raster content on this artboard → JPG, else PNG
  var abRect = artboard._aiRect;
  var items = ["placedItems", "rasterItems"];
  for (var t = 0; t < items.length; t++) {
    try {
      var collection = doc[items[t]];
      for (var i = 0; i < collection.length; i++) {
        var item = collection[i];
        if (!item.hidden && boundsIntersect(item.visibleBounds, abRect)) {
          return "jpg";
        }
      }
    } catch(e) {}
  }
  return "png";
}

// `hidden` is an accumulator supplied by the caller so already-hidden frames
// are still restorable if this loop throws partway through.
function hideTextFramesForExport(doc, artboard, settings, hidden) {
  // When testing_mode is on, keep all text visible for raster capture
  if (settings.testingMode) return hidden;
  var abRect = artboard._aiRect;
  for (var i = 0; i < doc.textFrames.length; i++) {
    var tf = doc.textFrames[i];
    if (tf.hidden) continue;
    if (tf.kind === TextType.PATHTEXT) continue;
    if (!boundsIntersect(tf.visibleBounds, abRect)) continue;
    // The same disposition extraction used: any frame whose element is
    // renderAs "image" (imageOnly artboard, global render_text_as, or a
    // rotated frame under render_rotated_skewed_text_as) must stay visible
    // so the raster contains it — its text exists nowhere else.
    if (decideTextFrameRenderAs(tf, artboard, settings).renderAs === "image") continue;
    tf.hidden = true;
    hidden.push(tf);
  }
  return hidden;
}

function restoreHiddenFrames(frames) {
  for (var i = frames.length - 1; i >= 0; i--) {
    try {
      frames[i].hidden = false;
    } catch(e) {
      warn("Could not unhide a text frame after image export: " + (e.message || e.toString()), "illustrator:restore-failed", "other");
    }
  }
}

// 0 is a declared-valid jpgQuality (settings-definitions min 0), so the
// default applies only on absence — `|| 85` erased a real 0.
function resolveJpgQuality(settings) {
  var quality = settings.jpgQuality;
  if (quality === undefined || quality === null) return 85;
  return quality;
}

function exportArtboardImage(doc, path, format, settings) {
  var file = new File(path);
  var scale = settings.use2xImages ? 200 : 100;

  if (format === "jpg") {
    var opts = new ExportOptionsJPEG();
    opts.artBoardClipping = true;
    opts.antiAliasing = false;
    opts.horizontalScale = scale;
    opts.verticalScale = scale;
    opts.qualitySetting = resolveJpgQuality(settings);
    doc.exportFile(file, ExportType.JPEG, opts);
  } else {
    var opts = new ExportOptionsPNG8();
    opts.artBoardClipping = true;
    opts.antiAliasing = false;
    opts.horizontalScale = scale;
    opts.verticalScale = scale;
    opts.transparency = settings.pngTransparent || false;
    opts.colorCount = settings.pngNumberOfColors || 128;
    doc.exportFile(file, ExportType.PNG8, opts);
  }
}

// `hidden` is an accumulator supplied by the caller so already-hidden layers
// are still restorable if this loop throws partway through.
function hideSpecialLayersForExport(doc, artboard, hidden) {
  // Any layer with ":" in its name is a special layer that gets its own export.
  // Hide them before capturing the background artboard image.
  var knownTags = ["svg", "png", "symbol", "div", "video", "html-before", "html-after", "svg,inline", "inline"];
  for (var i = 0; i < doc.layers.length; i++) {
    var layer = doc.layers[i];
    if (!layer.visible) continue;
    var name = layer.name;
    if (SPECIAL_NAME_RXP.test(name)) continue; // skip settings blocks
    var colonIdx = name.indexOf(":");
    if (colonIdx >= 0) {
      var tag = name.substring(colonIdx + 1).toLowerCase();
      var recognized = false;
      for (var j = 0; j < knownTags.length; j++) {
        if (tag === knownTags[j]) { recognized = true; break; }
      }
      if (!recognized) {
        warn("Unrecognized layer tag \":" + tag + "\" on layer \"" + name + "\". Layer will be hidden from background image.", "layer:unknown-tag", "markup");
      }
      layer.visible = false;
      hidden.push(layer);
    }
  }
  return hidden;
}

function restoreHiddenLayers(layers) {
  for (var i = layers.length - 1; i >= 0; i--) {
    try {
      layers[i].visible = true;
    } catch(e) {
      warn("Could not restore layer visibility after image export: " + (e.message || e.toString()), "illustrator:restore-failed", "other");
    }
  }
}

function exportImages(doc, artboards, settings) {
  var assets = {};
  var slug = settings.projectName;
  var outputPath = settings.outputPath;

  for (var i = 0; i < artboards.length; i++) {
    var ab = artboards[i];
    // Accumulators are created before the try so a throw inside either hide
    // pass still restores whatever was already hidden.
    var hiddenText = [];
    var hiddenLayers = [];

    try {
      hideTextFramesForExport(doc, ab, settings, hiddenText);
      hideSpecialLayersForExport(doc, ab, hiddenLayers);

      doc.artboards.setActiveArtboardIndex(ab._aiIndex);

      var format = resolveImageFormat(doc, ab, settings);

      // Warn about large exports that may exceed Illustrator limits
      var scaleFactor = settings.use2xImages ? 2 : 1;
      var pxW = Math.round(ab.actualWidth * scaleFactor);
      var pxH = Math.round(ab.actualHeight * scaleFactor);
      var pxCount = pxW * pxH;
      var mpThreshold = (format === "jpg") ? 32000000 : 5000000;
      if (pxCount > mpThreshold) {
        warn("Large " + format.toUpperCase() + " export for '" + ab.name + "' (" + pxW + "\u00d7" + pxH + " = " + Math.round(pxCount / 1000000) + "MP). Consider disabling 2x or reducing artboard size.", "image:large-export", "image");
      }

      var imageName = makeAssetName([
        slug,
        ab.source && ab.source.name ? ab.source.name : ab.name
      ]);
      if (assets[imageName]) {
        imageName = makeAssetName([imageName, ab._aiIndex + 1]);
      }
      var exportPath = outputPath + imageName;

      exportArtboardImage(doc, exportPath, format, settings);

      // Clean up Illustrator export artifacts (hex-named temp PNGs)
      try {
        var outFolder = new Folder(outputPath);
        var junk = outFolder.getFiles(function(f) {
          return /^[0-9A-F]{16}\.png$/i.test(f.name);
        });
        for (var ji = 0; ji < junk.length; ji++) {
          try { junk[ji].remove(); } catch(e) {}
        }
      } catch(e) {}

      // Illustrator adds the extension automatically
      var ext = format === "jpg" ? ".jpg" : ".png";
      assets[imageName] = {
        id: imageName,
        path: imageName + ext,
        mimeType: format === "jpg" ? "image/jpeg" : "image/png",
        width: ab.actualWidth * (settings.use2xImages ? 2 : 1),
        height: ab.actualHeight * (settings.use2xImages ? 2 : 1),
        artboardId: ab.id,
        source: {
          tool: "illustrator",
          name: ab.source && ab.source.name ? ab.source.name : ab.name
        },
        exportParams: {
          format: format,
          scale: settings.use2xImages ? 2 : 1,
          transparent: settings.pngTransparent || false,
          quality: resolveJpgQuality(settings),
          colors: settings.pngNumberOfColors || 128
        }
      };
    } finally {
      // Inverse order of mutation: layers were hidden last, so restore first.
      restoreHiddenLayers(hiddenLayers);
      restoreHiddenFrames(hiddenText);
    }
  }

  return assets;
}

// ============================================================
// Output
// ============================================================

function writeFile(path, content) {
  var f = new File(path);
  f.open("w", "TEXT", "TEXT");
  f.lineFeed = "Unix";
  f.encoding = "UTF-8";
  f.write(content);
  f.close();
}

function ensureFolder(path) {
  // Create folder and all parent directories
  var folder = new Folder(path);
  if (!folder.exists) {
    // Try creating parent chain
    var parts = path.split("/");
    var current = "";
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) { current += "/"; continue; }
      current += parts[i] + "/";
      var f = new Folder(current);
      if (!f.exists) {
        var created = f.create();
        if (!created) {
          warn("Could not create folder: " + current, "output:folder-failed", "other");
        }
      }
    }
  }
}

// ============================================================
// Config file reading
// ============================================================

function readConfigFile(path) {
  var f = new File(path);
  if (!f.exists) return null;
  try {
    f.open("r");
    f.encoding = "UTF-8";
    var content = f.read();
    f.close();
    // Strip // comments
    content = content.replace(/^\s*\/\/.*$/gm, "");
    return JSON.parse(content);
  } catch(e) {
    return null;
  }
}

function loadConfigFiles(docPath) {
  var config = { fonts: [], settings: {} };

  // Try local config: all2html.config.json or ai2html-config.json
  var localPaths = [
    docPath + "all2html.config.json",
    docPath + "ai2html-config.json"
  ];
  for (var i = 0; i < localPaths.length; i++) {
    var c = readConfigFile(localPaths[i]);
    if (c) {
      if (c.fonts) config.fonts = c.fonts;
      if (c.settings) {
        for (var key in c.settings) {
          if (c.settings.hasOwnProperty(key)) {
            config.settings[key] = c.settings[key];
          }
        }
      }
      break;
    }
  }
  return config;
}

// ============================================================
// Overset text detection
// ============================================================

function checkOversetText(tf) {
  if (tf.kind !== TextType.AREATEXT) return false;
  try {
    // If the text frame has more lines than fit, it's overset
    // Check by comparing characters length vs visible characters
    var totalChars = tf.contents.length;
    var visibleChars = 0;
    for (var i = 0; i < tf.lines.length; i++) {
      visibleChars += tf.lines[i].contents.length;
    }
    if (totalChars > visibleChars + tf.paragraphs.length) {
      return true;
    }
  } catch(e) {}
  return false;
}

// ============================================================
// Main execution
// ============================================================

var _logStart = new Date().getTime();
function log(msg) {
  var elapsed = ((new Date().getTime() - _logStart) / 1000).toFixed(2);
  var line = "[" + elapsed + "s] all2html: " + msg;
  try { $.writeln(line); } catch(e) {}
  // $.writeln reaches only the ExtendScript console, which neither the panel nor
  // an AppleEvent caller can read. Diagnostics is where these are looked for.
  logDiagnostic("info", line);
}

function logSpan(name) {
  var start = new Date().getTime();
  log(name + " ...");
  return {
    end: function(detail) {
      var ms = new Date().getTime() - start;
      log(name + " done (" + ms + "ms)" + (detail ? " " + detail : ""));
    }
  };
}

// Categories and their display order come from src/core/warnings.ts. Grouping
// reads the declared category and never inspects the message.
//
// This replaces a substring classifier that filed the core's category:"setting"
// warnings under "other", because it matched lowercase "setting" against
// messages that begin with a capitalized "Setting". Do not reintroduce one:
// codes and categories are assigned at the call site on both sides of the
// boundary, so there is nothing left to guess.
var WARNING_CATEGORY_ORDER = ["setting", "font", "text", "image", "geometry", "markup", "template", "other"];

function groupStructuredWarnings(list) {
  var groups = {};
  for (var i = 0; i < WARNING_CATEGORY_ORDER.length; i++) {
    groups[WARNING_CATEGORY_ORDER[i]] = [];
  }
  for (var j = 0; j < list.length; j++) {
    var entry = list[j];
    if (!entry) continue;
    var category = entry.category;
    if (!hasOwn(groups, category)) category = "other";
    groups[category].push(entry.message);
  }
  return groups;
}

function hasOwn(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function readBoolSetting(obj, key) {
  if (!hasOwn(obj, key)) return undefined;
  var value = obj[key];
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function readIntSetting(obj, key) {
  if (!hasOwn(obj, key)) return undefined;
  var value = parseInt(obj[key], 10);
  return isNaN(value) ? undefined : value;
}

function readNullableIntSetting(obj, key) {
  if (!hasOwn(obj, key)) return undefined;
  if (obj[key] === null || obj[key] === "" || obj[key] === "null") return null;
  var value = parseInt(obj[key], 10);
  return isNaN(value) ? undefined : value;
}

/**
 * String settings accept strings, and nothing else. `String(obj[key])` ran here,
 * which is how `project_name: null` became the literal slug "null" and emitted
 * null.html while the raw `project_name || docName` path read the same key as
 * falsy and put the document name in metadata.slug. Rejecting applies the
 * declared default, which is what every other invalid setting already gets.
 */
function readStringSetting(obj, key) {
  if (!hasOwn(obj, key)) return undefined;
  var value = obj[key];
  if (typeof value === "string") return value;
  warn('Setting "' + key + '" must be text. Using the default instead.', "setting:invalid-value", "setting");
  return undefined;
}

function acceptString(value) {
  return typeof value === "string" ? value : undefined;
}

function buildCanonicalIrSettings(docSettings) {
  var settings = {};
  var imageFormat = readStringSetting(docSettings, "image_format");
  if (imageFormat) settings.imageFormat = imageFormat.split(/[,\s]+/);

  var output = readStringSetting(docSettings, "output");
  if (output) settings.output = output;

  var responsiveness = readStringSetting(docSettings, "responsiveness");
  if (responsiveness) settings.responsiveness = responsiveness;

  var textResponsiveness = readStringSetting(docSettings, "text_responsiveness");
  if (textResponsiveness) settings.textResponsiveness = textResponsiveness;

  var renderTextAs = readStringSetting(docSettings, "render_text_as");
  if (renderTextAs) settings.renderTextAs = renderTextAs;

  var rotatedText = readStringSetting(docSettings, "render_rotated_skewed_text_as");
  if (rotatedText) settings.renderRotatedSkewedTextAs = rotatedText;

  var googleFonts = readStringSetting(docSettings, "google_fonts");
  if (googleFonts === "none" || googleFonts === "import" || googleFonts === "link") {
    settings.googleFonts = googleFonts;
  }

  var namespace = readStringSetting(docSettings, "namespace");
  if (namespace) settings.namespace = namespace;

  var projectName = readStringSetting(docSettings, "project_name");
  if (projectName) settings.projectName = projectName;

  var htmlOutputPath = readStringSetting(docSettings, "html_output_path");
  if (htmlOutputPath) settings.htmlOutputPath = htmlOutputPath;

  var imageOutputPath = readStringSetting(docSettings, "image_output_path");
  if (imageOutputPath) settings.imageOutputPath = imageOutputPath;

  var htmlOutputExtension = readStringSetting(docSettings, "html_output_extension");
  if (htmlOutputExtension) settings.htmlOutputExtension = htmlOutputExtension;

  var imageSourcePath = readStringSetting(docSettings, "image_source_path");
  if (imageSourcePath) settings.imageSourcePath = imageSourcePath;

  var clickableLink = readStringSetting(docSettings, "clickable_link");
  if (clickableLink) settings.clickableLink = clickableLink;

  var localPreviewTemplate = readStringSetting(docSettings, "local_preview_template");
  if (localPreviewTemplate) settings.localPreviewTemplate = localPreviewTemplate;

  var jpgQuality = readIntSetting(docSettings, "jpg_quality");
  if (jpgQuality !== undefined) settings.jpgQuality = jpgQuality;

  var pngNumberOfColors = readIntSetting(docSettings, "png_number_of_colors");
  if (pngNumberOfColors !== undefined) settings.pngNumberOfColors = pngNumberOfColors;

  var promoImageWidth = readIntSetting(docSettings, "promo_image_width");
  if (promoImageWidth !== undefined) settings.promoImageWidth = promoImageWidth;

  var maxWidth = readNullableIntSetting(docSettings, "max_width");
  if (maxWidth !== undefined) settings.maxWidth = maxWidth;

  var cacheBustToken = readNullableIntSetting(docSettings, "cache_bust_token");
  if (cacheBustToken !== undefined) settings.cacheBustToken = cacheBustToken;

  var boolMap = {
    png_transparent: "pngTransparent",
    use_2x_images_if_possible: "use2xImages",
    center_html_output: "centerHtmlOutput",
    testing_mode: "testingMode",
    include_resizer_css: "includeResizerCss",
    include_resizer_widths: "includeResizerWidths",
    use_lazy_loader: "useLazyLoader",
    svg_embed_images: "svgEmbedImages",
    create_promo_image: "createPromoImage"
  };
  for (var key in boolMap) {
    if (!boolMap.hasOwnProperty(key)) continue;
    var boolValue = readBoolSetting(docSettings, key);
    if (boolValue !== undefined) settings[boolMap[key]] = boolValue;
  }

  return settings;
}

/**
 * Makes the canonical settings bag safe to *persist*, not just safe to render.
 *
 * ir.json is written before All2Html.processAndEmit() runs, so the core
 * sanitizer only ever repaired its in-memory copy. The file on
 * disk kept whatever the ai2html-settings text block said — a project_name of
 * "../../pwn" was written verbatim — which made ir.json a document we produced
 * ourselves and loadAndValidateIR rejects. That is the contract break; the
 * emitted HTML was already safe.
 *
 * project_name gets one repair attempt because its keyword form is already the
 * emitted slug. Every resulting value then crosses the shared
 * SETTING_DEFINITIONS-derived boundary; invalid identifiers, enums, arrays and
 * numeric ranges are removed so the declared default applies.
 */
function sanitizeCanonicalSettings(settings) {
  if (settings.projectName !== undefined && settings.projectName !== "") {
    var rawProjectName = settings.projectName;
    settings.projectName = makeKeyword(String(rawProjectName));
    if (settings.projectName === "") {
      delete settings.projectName;
      warn('Setting "projectName" has an invalid value "' + rawProjectName + '". Using the default instead.', "setting:invalid-value", "setting");
    }
  }
  for (var key in settings) {
    if (!settings.hasOwnProperty(key)) continue;
    if (All2Html.isValidSettingValue(key, settings[key])) continue;
    var raw = settings[key];
    delete settings[key];
    warn('Setting "' + key + '" has an invalid value "' + raw + '". Using the default instead.', "setting:invalid-value", "setting");
  }
}

/**
 * The export-run view of the settings `sanitizeCanonicalSettings` just validated.
 *
 * There used to be two bags: the canonical one, validated and persisted, and a
 * separate literal that re-parsed the same raw docSettings and drove image
 * extraction. So `image_format: gif` was stripped from ir.json and still reached
 * exportParams.format, and an out-of-range jpg_quality changed the exported JPEG
 * while ir.json recorded the default — the bytes and the record describing them
 * disagreed, and the file we wrote failed our own schema.
 *
 * An absent key here means the value was never set or was rejected; both mean the
 * declared default applies, which is the core sanitizer's own fallback.
 * `projectName` is passed in instead: it may legitimately be absent (a legal slug
 * can be an illegal CSS identifier) while the asset-name base always needs one.
 */
function readCanonicalSetting(canonical, key) {
  return hasOwn(canonical, key) ? canonical[key] : All2Html.defaultSettings[key];
}

function buildExportSettings(canonical, slug, outputPath) {
  return {
    projectName: slug,
    outputPath: outputPath,
    imageFormat: readCanonicalSetting(canonical, "imageFormat"),
    pngTransparent: readCanonicalSetting(canonical, "pngTransparent"),
    pngNumberOfColors: readCanonicalSetting(canonical, "pngNumberOfColors"),
    jpgQuality: readCanonicalSetting(canonical, "jpgQuality"),
    use2xImages: readCanonicalSetting(canonical, "use2xImages"),
    createPromoImage: readCanonicalSetting(canonical, "createPromoImage"),
    promoImageWidth: readCanonicalSetting(canonical, "promoImageWidth"),
    renderTextAs: readCanonicalSetting(canonical, "renderTextAs"),
    renderRotatedSkewedTextAs: readCanonicalSetting(canonical, "renderRotatedSkewedTextAs"),
    testingMode: readCanonicalSetting(canonical, "testingMode"),
    svgEmbedImages: readCanonicalSetting(canonical, "svgEmbedImages")
  };
}

function getFontSourceKey(font) {
  return font && (font.sourceFont || font.aifont) ? String(font.sourceFont || font.aifont) : "";
}

/**
 * One optional font field. `weight`/`vshift` accept finite numbers (a JSON config
 * spelling a CSS weight as 700 is well-formed); `style` does not, since no number
 * is a CSS font-style. Empty strings are kept — the panel writes them for "unset".
 */
function appendFontField(target, key, raw, sourceFont, allowNumber) {
  if (raw === undefined || raw === null) return;
  if (typeof raw === "string") {
    target[key] = raw;
    return;
  }
  if (allowNumber && typeof raw === "number" && isFinite(raw)) {
    target[key] = String(raw);
    return;
  }
  warn('Font mapping "' + sourceFont + '" has an invalid ' + key + '. Ignoring that field.', "font:invalid-mapping", "font");
}

/**
 * Font mappings, normalized to what FontMappingSchema accepts. Per-field policy,
 * not blind stringification: `String(value)` on a structural value persists
 * "[object Object]" as a family — schema-valid, garbage CSS. The empty check on
 * the *normalized* family is not redundant: `[]` is truthy but `String([])` is "",
 * so a `family || sourceFont` fallback applied first lets an array through as
 * exactly the empty string `min(1)` rejects.
 */
function normalizeFontMappings(fonts) {
  var normalized = [];
  for (var i = 0; i < fonts.length; i++) {
    var font = fonts[i];
    if (!font || typeof font !== "object") {
      warn("Ignoring a font mapping that is not an object.", "font:invalid-mapping", "font");
      continue;
    }
    var sourceFont = acceptString(font.sourceFont) || acceptString(font.aifont) || "";
    if (!sourceFont) {
      warn("Ignoring a font mapping with no usable source font name.", "font:invalid-mapping", "font");
      continue;
    }
    var family = acceptString(font.family) || "";
    if (!family) {
      if (font.family !== undefined && font.family !== null && font.family !== "") {
        warn('Font mapping "' + sourceFont + '" has an invalid family. Using the source font name.', "font:invalid-mapping", "font");
      }
      family = sourceFont;
    }
    var next = { sourceFont: sourceFont, family: family };
    appendFontField(next, "weight", font.weight, sourceFont, true);
    appendFontField(next, "style", font.style, sourceFont, false);
    appendFontField(next, "vshift", font.vshift, sourceFont, true);
    normalized.push(next);
  }
  return normalized;
}

// [source key, canonical key, fallback]. A `null` fallback omits the key entirely
// when absent or empty: the model must survive a JSON round-trip and assertJsonPure
// aborts on `undefined`. Adding a metadata string is one row, not a new rule.
var METADATA_FIELDS = [
  ["headline", "headline", ""],
  ["leadin", "leadin", ""],
  ["summary", "summary", ""],
  ["notes", "notes", ""],
  ["sources", "sources", ""],
  ["credit", "credit", ""],
  ["alt_text", "altText", null],
  ["image_alt_text", "imageAltText", null],
  ["aria_role", "ariaRole", null]
];

function normalizeMetadataFields(docSettings, slug) {
  var metadata = { slug: slug };
  for (var i = 0; i < METADATA_FIELDS.length; i++) {
    var sourceKey = METADATA_FIELDS[i][0];
    var canonicalKey = METADATA_FIELDS[i][1];
    var fallback = METADATA_FIELDS[i][2];
    var raw = hasOwn(docSettings, sourceKey) ? docSettings[sourceKey] : undefined;
    if (typeof raw === "string" && raw !== "") {
      metadata[canonicalKey] = raw;
      continue;
    }
    if (raw !== undefined && raw !== null && typeof raw !== "string") {
      warn('Metadata "' + sourceKey + '" must be text. Ignoring it.', "metadata:invalid-value", "setting");
    }
    if (fallback !== null) metadata[canonicalKey] = fallback;
  }
  return metadata;
}

/**
 * The one place untyped Illustrator input becomes typed exporter input.
 *
 * Three sources arrive with no schema: all2html.config.json (JSON.parse), the CEP
 * panel payloads, and document text blocks. Their values were read into typed
 * operations at nine call sites with ad-hoc rules or none, so a non-string
 * project_name crashed makeKeyword before any settings boundary ran, and fonts and
 * metadata persisted numbers and objects into typed IR string fields.
 *
 * After this call runExporter reads no raw docSettings key and no raw font entry.
 * `inputs.settings` IS the canonical bag — built here, not copied — so this stays
 * one validated settings object rather than becoming a second.
 */
function normalizeIllustratorInputs(docSettings, fonts, docName) {
  var settings = buildCanonicalIrSettings(docSettings);
  sanitizeCanonicalSettings(settings);

  // From the project name that *survived* validation, never the raw key: the two
  // disagree exactly when the raw value is malformed, and then name different files.
  var slug = settings.projectName || makeKeyword(docName) || "graphic";
  var dialog = docSettings.show_completion_dialog_box;

  return {
    settings: settings,
    slug: slug,
    fonts: normalizeFontMappings(fonts),
    metadata: normalizeMetadataFields(docSettings, slug),
    controls: {
      writeIr: readBoolSetting(docSettings, "write_ir") !== false,
      showDialog: dialog !== "no" && dialog !== "false" && dialog !== false
    }
  };
}

function runExporter() {
  // Reset global state (ExtendScript may persist globals across runs)
  warnings = [];
  structuredWarnings = [];
  restoreActions = [];
  unlockedObjectCount = 0;
  docToMarkSaved = null;

  var startTime = new Date().getTime();
  var span;

  // Must come before any exportFile() call. See suppressUserInteraction().
  suppressUserInteraction();

  span = logSpan("validateDocument");
  var doc = validateDocument();
  var docPath = doc.path + "/";
  var docSaved = doc.saved;
  var docName = doc.name.replace(/\.ai$/i, "");
  span.end(doc.name);

  span = logSpan("unlockObjects");
  unlockObjects(doc);
  span.end(unlockedObjectCount + " unlocked");

  span = logSpan("loadConfigFiles");
  var configFile = loadConfigFiles(docPath);
  span.end(configFile.fonts.length + " fonts");

  span = logSpan("parseSpecialBlocks");
  var parsed = parseSpecialBlocks(doc);
  var textBlockSettings = parsed.settings;
  var customBlocks = parsed.customBlocks;
  span.end(Object.keys(textBlockSettings).length + " settings, " + customBlocks.length + " blocks");

  var panelSettings = {};

  // CEP panel settings injection: panel writes settings to a temp file,
  // sets $.global.__ALL2HTML_PANEL_SETTINGS_PATH__ to the file path.
  // Panel settings override config file but NOT text block settings.
  try {
    if ($.global.__ALL2HTML_PANEL_SETTINGS_PATH__) {
      var panelFile = new File($.global.__ALL2HTML_PANEL_SETTINGS_PATH__);
      if (panelFile.exists) {
        panelFile.open("r");
        panelFile.encoding = "UTF-8";
        var panelSettingsRaw = panelFile.read();
        panelFile.close();
        panelSettings = JSON.parse(panelSettingsRaw);
      }
    }
  } catch(e) {
    warn("Panel settings injection failed: " + e.message, "setting:panel-injection-failed", "setting");
  }

  // CEP panel font injection
  try {
    if ($.global.__ALL2HTML_PANEL_FONTS__) {
      var panelFonts = JSON.parse($.global.__ALL2HTML_PANEL_FONTS__);
      if (panelFonts && panelFonts.length > 0) {
        for (var fi = 0; fi < panelFonts.length; fi++) {
          var pf = panelFonts[fi];
          var pfSource = getFontSourceKey(pf);
          var fontFound = false;
          for (var ci = 0; ci < configFile.fonts.length; ci++) {
            if (getFontSourceKey(configFile.fonts[ci]) === pfSource) {
              configFile.fonts[ci] = pf;
              fontFound = true;
              break;
            }
          }
          if (!fontFound) configFile.fonts.push(pf);
        }
      }
    }
  } catch(e) {
    warn("Panel font injection failed: " + e.message, "font:panel-injection-failed", "font");
  }

  // Resolve settings with explicit precedence:
  // config file < panel < text block
  var docSettings = {};
  for (var ckey in configFile.settings) {
    if (configFile.settings.hasOwnProperty(ckey)) {
      docSettings[ckey] = configFile.settings[ckey];
    }
  }
  for (var pkey in panelSettings) {
    if (panelSettings.hasOwnProperty(pkey)) {
      docSettings[pkey] = panelSettings[pkey];
    }
  }
  for (var tkey in textBlockSettings) {
    if (textBlockSettings.hasOwnProperty(tkey)) {
      docSettings[tkey] = textBlockSettings[tkey];
    }
  }

  // Normalize once, here, and derive everything downstream from the result.
  // Before irDoc is built, because irDoc is written to disk below and has to
  // satisfy the canonical schema on its own — and before `settings`, because the
  // export run must not act on a value the persisted document rejects.
  var inputs = normalizeIllustratorInputs(docSettings, configFile.fonts || [], docName);
  var canonicalIrSettings = inputs.settings;
  var slug = inputs.slug;
  var outputPath = resolveDocumentOutputPath(canonicalIrSettings, docPath);

  var settings = buildExportSettings(canonicalIrSettings, slug, outputPath);

  if (settings.imageFormat && settings.imageFormat.length > 1) {
    warn("Multiple image formats specified; currently only the first is used: " + settings.imageFormat[0], "setting:multiple-image-formats", "setting");
  }

  ensureFolder(outputPath);

  span = logSpan("extractArtboards");
  var artboards = extractArtboards(doc);
  if (artboards.length === 0) {
    throw new Error("No usable artboards found (all start with '-').");
  }
  var layers = extractLayers(doc);
  span.end(artboards.length + " artboards, " + layers.length + " layers");

  // Extract text for each artboard
  for (var i = 0; i < artboards.length; i++) {
    var abSpan = logSpan("extractText:" + artboards[i].name);
    artboards[i].layers = [];
    for (var j = 0; j < layers.length; j++) {
      var abLayer = {
        id: artboards[i].id + ":layer:" + makeKeyword(layers[j].name || layers[j].type) + "-" + (j + 1),
        name: layers[j].name,
        type: layers[j].type,
        source: layers[j].source,
        visible: layers[j].visible,
        opacity: layers[j].opacity,
        elements: []
      };
      // Written only when true — see extractLayers.
      if (layers[j].inlineSvg) abLayer.inlineSvg = true;
      artboards[i].layers.push(abLayer);
    }
    extractTextFramesForArtboard(doc, artboards[i], artboards[i].layers, settings);
    var textCount = 0;
    for (var j = 0; j < artboards[i].layers.length; j++) {
      textCount += artboards[i].layers[j].elements.length;
    }
    abSpan.end(textCount + " elements");
  }

  span = logSpan("exportImages");
  var assets = exportImages(doc, artboards, settings);
  span.end(Object.keys(assets).length + " images");

  span = logSpan("extractLayerContent");
  for (var i = 0; i < artboards.length; i++) {
    extractLayerContent(doc, artboards[i], artboards[i].layers, settings, assets);
  }
  span.end(Object.keys(assets).length + " total assets");

  // Build IR document
  span = logSpan("buildIR");
  // Clean artboards of internal properties
  var cleanArtboards = [];
  for (var i = 0; i < artboards.length; i++) {
    var ab = artboards[i];
    var clean = {
      id: ab.id,
      name: ab.name,
      width: ab.width,
      height: ab.height,
      source: ab.source,
      layers: ab.layers
    };
    if (ab.responsiveness) clean.responsiveness = ab.responsiveness;
    // `imageOnly` stays an exporter-local decision (decideTextFrameRenderAs);
    // its canonical trace is renderAs:"image" text plus the background asset.
    cleanArtboards.push(clean);
  }

  var irDoc = {
    irVersion: "0.1.0",
    source: {
      tool: "illustrator",
      toolVersion: app.version,
      adapterVersion: "0.1.0"
    },
    settings: canonicalIrSettings,
    fonts: inputs.fonts,
    artboards: cleanArtboards,
    customBlocks: customBlocks,
    assets: assets,
    metadata: inputs.metadata
  };

  span.end();

  // Write IR JSON for debugging (disable with write_ir: false)
  if (inputs.controls.writeIr) {
    span = logSpan("writeIR");
    writeFile(outputPath + "ir.json", JSON.stringify(irDoc, null, 2));
    span.end();
  }

  // Call core to generate HTML
  span = logSpan("processAndEmit");
  var result = All2Html.processAndEmit(irDoc, {
    // The same array irDoc carries, not a second normalization. Kept rather than
    // dropped: mergeFonts replaces the FIRST entry matching a sourceFont, so with
    // duplicate source fonts the merged table is not the base table and removing
    // this would change which family a duplicate resolves to.
    fonts: inputs.fonts
  });
  pushCoreWarnings(result);
  span.end(warnings.length + " warnings");

  // Write HTML. One file per artboard group: the core honors `output`
  // ("one-file" -> a single group named after the document, "multiple-files" ->
  // one group per artboard base name), and the filename is the group slug, not
  // the document slug. In one-file mode that slug IS the document slug, so this
  // writes the same path it always did.
  span = logSpan("writeHTML");
  var emittedFiles = result.files || [];
  for (var fi = 0; fi < emittedFiles.length; fi++) {
    var emitted = emittedFiles[fi];
    writeFile(outputPath + emitted.slug + emitted.extension, emitted.output);
  }
  span.end(emittedFiles.length + " file(s)");

  // Promo image generation
  if (settings.createPromoImage && artboards.length > 0) {
    try {
      // Find largest artboard by area
      var largestAb = artboards[0];
      var largestArea = largestAb.actualWidth * largestAb.actualHeight;
      for (var pi = 1; pi < artboards.length; pi++) {
        var area = artboards[pi].actualWidth * artboards[pi].actualHeight;
        if (area > largestArea) {
          largestAb = artboards[pi];
          largestArea = area;
        }
      }
      doc.artboards.setActiveArtboardIndex(largestAb._aiIndex);
      var promoWidth = settings.promoImageWidth;
      var promoScale = 100 * promoWidth / largestAb.actualWidth;
      var promoFile = new File(docPath + slug + "-promo");
      var promoOpts = new ExportOptionsPNG8();
      promoOpts.artBoardClipping = true;
      promoOpts.antiAliasing = true;
      promoOpts.horizontalScale = promoScale;
      promoOpts.verticalScale = promoScale;
      promoOpts.colorCount = 256;
      doc.exportFile(promoFile, ExportType.PNG8, promoOpts);
    } catch(e) {
      warn("Promo image generation failed: " + e.message, "image:promo-failed", "image");
    }
  }

  // Cache bust auto-increment, read from the validated bag: it is already a number
  // or null, where the raw key needed its own parseInt/isNaN dance.
  var cacheBustToken = canonicalIrSettings.cacheBustToken;
  if (typeof cacheBustToken === "number") {
    var newToken = cacheBustToken + 1;
    // Find and update the settings text frame, under either spelling.
    var settingsFrame = findSettingsTextFrame(doc);
    if (settingsFrame) {
      try {
        var contents = settingsFrame.contents;
        contents = contents.replace(
          /cache_bust_token\s*:\s*\d+/,
          "cache_bust_token: " + newToken
        );
        settingsFrame.contents = contents;
      } catch(e2) {
        // Settings frame can't be updated
      }
    }
  }

  // Document saved-flag restore happens in executeAll2Html, after
  // relock/unhide — restoring it here would be undone by those mutations.
  if (docSaved) {
    docToMarkSaved = doc;
  }

  return {
    outputPath: outputPath,
    slug: slug,
    artboardCount: artboards.length,
    imageCount: Object.keys(assets).length,
    startTime: startTime,
    showDialog: inputs.controls.showDialog
  };
}

// ============================================================
// Entry point (called from assembled all2html.js)
// ============================================================

// Detect automated mode. Caller sets $.global.ALL2HTML_AUTOMATED = true before running.
var ALL2HTML_AUTOMATED = false;
try { ALL2HTML_AUTOMATED = !!$.global.ALL2HTML_AUTOMATED; } catch(e) {}

function executeAll2Html() {
  var result;
  try {
    logDiagnostic("info", "Starting Illustrator export");
    result = runExporter();
  } catch(e) {
    // Restore state on error (LIFO: inverse order of mutation)
    runRestoreActions();
    var errMsg = (e.name === "UserError" || e.message) ? e.message : e.toString();
    logDiagnostic("error", "Illustrator export failed", errMsg);
    if (ALL2HTML_AUTOMATED) {
      // Same envelope as the success path below: `warnings` is the grouped
      // object the panel's RunResult type declares, never the plain string
      // array. Returning the raw array here made the panel read a string as a
      // category list — "48 warnings" for one 48-character message, one row per
      // character. Nothing type-checks this file, so the shape is asserted in
      // test/unit/illustrator-warning-plumbing.test.ts instead.
      return JSON.stringify({
        success: false,
        error: errMsg,
        warnings: groupStructuredWarnings(structuredWarnings),
        structuredWarnings: structuredWarnings
      });
    }
    alert("all2html error:\n\n" + errMsg);
    return;
  }

  // Restore state on success (LIFO: inverse order of mutation)
  var failedRestores = runRestoreActions();
  if (docToMarkSaved) {
    // Only a fully restored document is clean. A failed restore means the file
    // really is modified: leave it dirty so Illustrator prompts on close.
    if (failedRestores === 0) {
      try { docToMarkSaved.saved = true; } catch(e) {}
    }
    docToMarkSaved = null;
  }

  var elapsed = ((new Date().getTime() - result.startTime) / 1000).toFixed(1);
  log("done in " + elapsed + "s");
  logDiagnostic("info", "Illustrator export finished", elapsed + "s");

  var summary = {
    success: true,
    outputPath: result.outputPath,
    slug: result.slug,
    artboardCount: result.artboardCount,
    imageCount: result.imageCount,
    elapsed: elapsed + "s",
    // Automated callers get the warnings grouped by declared category; the
    // full structured list travels with them so codes, categories, and the
    // core's setting/artboard/layer context survive the boundary.
    warnings: ALL2HTML_AUTOMATED ? groupStructuredWarnings(structuredWarnings) : warnings,
    structuredWarnings: structuredWarnings
  };

  if (ALL2HTML_AUTOMATED) {
    // Return JSON for programmatic consumption
    return JSON.stringify(summary);
  }

  // Interactive mode: show dialog
  var msg = "all2html finished.\n\n";
  msg += "Output: " + result.outputPath + "\n";
  msg += "Artboards: " + result.artboardCount + "\n";
  msg += "Images: " + result.imageCount + "\n";
  if (warnings.length > 0) {
    msg += "\nWarnings (" + warnings.length + "):\n";
    for (var i = 0; i < warnings.length && i < 10; i++) {
      msg += "  " + warnings[i] + "\n";
    }
    if (warnings.length > 10) {
      msg += "  ...and " + (warnings.length - 10) + " more.\n";
    }
  }
  alert(msg);
}

// Store result globally so 'do javascript' can capture it
$.global.__ALL2HTML_RESULT__ = executeAll2Html();
