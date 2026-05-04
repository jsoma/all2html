/* eslint-disable no-undef */
(function () {
  var DEFAULT_OVERLAY_PREFIX = "overlay:";
  var VIDEO_TEMPLATE_CANDIDATES = [
    "H.264",
    "H.264 - Match Render Settings - 15 Mbps",
    "H.264 - Match Render Settings - 40 Mbps",
    "MP4"
  ];
  var POSTER_TEMPLATE_CANDIDATES = ["PNG Sequence with Alpha", "PNG Sequence", "JPEG Sequence"];
  var DEFAULT_POSTER_FRAME_RATIO = 0.15;
  var EMBEDDED_JSON2 =
    $.global && typeof $.global.__ALL2HTML_AE_JSON2__ === "string"
      ? $.global.__ALL2HTML_AE_JSON2__
      : null;
  var EMBEDDED_PLAYER_TEMPLATE =
    $.global && typeof $.global.__ALL2HTML_AE_PLAYER_TEMPLATE__ === "string"
      ? $.global.__ALL2HTML_AE_PLAYER_TEMPLATE__
      : null;
  var ALL2HTML_AUTOMATED = $.global && $.global.ALL2HTML_AUTOMATED ? true : false;

  function logDiagnostic(level, message, detail) {
    try {
      if ($.global && typeof $.global.__ALL2HTML_LOG__ === "function") {
        $.global.__ALL2HTML_LOG__("ae-exporter", level, String(message), detail ? String(detail) : undefined);
      }
    } catch (e) {}
  }

  function fail(message) {
    logDiagnostic("error", "After Effects export failed", message);
    throw new Error("[all2html-ae] " + message);
  }

  function toArray(value) {
    var out = [];
    var i;
    for (i = 0; i < value.length; i += 1) out.push(value[i]);
    return out;
  }

  function countOwnKeys(value) {
    var count = 0;
    var key;
    for (key in value) {
      if (value.hasOwnProperty(key)) count += 1;
    }
    return count;
  }

  function basename(path) {
    return String(path || "").replace(/^.*[\\\/]/, "");
  }

  function safeCompName(name) {
    return String(name || "ae-temporal")
      .replace(/^\s+|\s+$/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ae-temporal";
  }

  function ensureFolder(path) {
    var folder = new Folder(path);
    if (folder.exists) {
      return folder;
    }

    var normalized = String(path).replace(/\\/g, "/");
    var parts = normalized.split("/");
    var current = "";
    var i;

    for (i = 0; i < parts.length; i += 1) {
      if (!parts[i]) {
        current += "/";
        continue;
      }
      current += parts[i] + "/";
      var f = new Folder(current);
      if (!f.exists && !f.create()) {
        fail("Unable to create folder: " + current);
      }
    }
    return folder;
  }

  function writeFile(path, content) {
    var file = new File(path);
    file.lineFeed = "Unix";
    file.encoding = "UTF-8";
    if (!file.open("w")) fail("Unable to open file for write: " + path);
    file.write(content);
    file.close();
  }

  function readFile(path) {
    var file = new File(path);
    file.encoding = "UTF-8";
    if (!file.exists) fail("Missing required file: " + path);
    if (!file.open("r")) fail("Unable to open file for read: " + path);
    var content = file.read();
    file.close();
    return content;
  }

  function ensureJsonGlobal(baseFolderPath) {
    if (typeof JSON !== "undefined" && typeof JSON.stringify === "function") {
      return;
    }

    if (EMBEDDED_JSON2) {
      eval(EMBEDDED_JSON2);
      if (typeof JSON !== "undefined" && typeof JSON.stringify === "function") {
        return;
      }
    }

    var baseFolder = new Folder(baseFolderPath);
    var rootFolder = baseFolder.parent && baseFolder.parent.parent ? baseFolder.parent.parent : null;
    if (!rootFolder) {
      fail("Unable to resolve repo root for JSON polyfill loading.");
    }

    var polyfillPath = rootFolder.fsName + "/plugins/illustrator/json2.js";
    var polyfillFile = new File(polyfillPath);
    if (!polyfillFile.exists) {
      fail("JSON is unavailable and the Illustrator JSON2 polyfill was not found at " + polyfillPath);
    }

    $.evalFile(polyfillFile);
    if (typeof JSON === "undefined" || typeof JSON.stringify !== "function") {
      fail("JSON polyfill load failed.");
    }
  }

  function asRgbString(colorValue) {
    if (!colorValue || colorValue.length < 3) return "rgb(255,255,255)";
    var r = Math.round(colorValue[0] * 255);
    var g = Math.round(colorValue[1] * 255);
    var b = Math.round(colorValue[2] * 255);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function guessWeight(textDocument) {
    var name = String(textDocument.font || "");
    if (/thin/i.test(name)) return "100";
    if (/extra[- ]?light|ultra[- ]?light/i.test(name)) return "200";
    if (/light/i.test(name)) return "300";
    if (/medium/i.test(name)) return "500";
    if (/semi[- ]?bold|demi[- ]?bold/i.test(name)) return "600";
    if (/extra[- ]?bold|ultra[- ]?bold|black|heavy/i.test(name)) return "800";
    if (/bold/i.test(name) || textDocument.fauxBold) return "700";
    return "400";
  }

  function guessFontStyle(textDocument) {
    var name = String(textDocument.font || "");
    if (/italic|oblique/i.test(name) || textDocument.fauxItalic) return "italic";
    return "normal";
  }

  function guessTextAlign(textDocument) {
    var justification = textDocument.justification;
    if (justification === ParagraphJustification.CENTER_JUSTIFY) return "center";
    if (
      justification === ParagraphJustification.RIGHT_JUSTIFY ||
      justification === ParagraphJustification.FULL_JUSTIFY_LASTLINE_RIGHT
    ) return "right";
    return "left";
  }

  function isTextLayer(layer) {
    return layer && layer.matchName === "ADBE Text Layer";
  }

  function startsWithOverlay(name, overlayPrefix) {
    return String(name || "").indexOf(String(overlayPrefix || DEFAULT_OVERLAY_PREFIX)) === 0;
  }

  function secondsToStartFrame(seconds, fps) {
    return Math.max(0, Math.round(seconds * fps));
  }

  function secondsToEndFrame(seconds, fps) {
    return Math.max(0, Math.ceil(seconds * fps - 0.0001) - 1);
  }

  function sampleTimeForFrame(frame, fps, displayStartTime) {
    return displayStartTime + frame / fps;
  }

  function clamp01(value) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  function round4(value) {
    return Math.round(value * 10000) / 10000;
  }

  function escapeInlineJson(json) {
    return String(json)
      .replace(/<\//g, "<\\/")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  }

  function getProperty(group, name) {
    return group ? group.property(name) : null;
  }

  function getProjectFolder() {
    if (!app.project || !app.project.file || !app.project.file.parent) {
      fail("Please save the After Effects project before export.");
    }

    return app.project.file.parent.fsName;
  }

  function parseJsonFile(path) {
    try {
      var raw = readFile(path).replace(/^\s*\/\/.*$/gm, "");
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function loadProjectConfig() {
    return parseJsonFile(getProjectFolder() + "/all2html-ae.config.json") || {};
  }

  function loadPanelSettings() {
    if (!$.global || !$.global.__ALL2HTML_AE_PANEL_SETTINGS__) {
      return {};
    }
    try {
      return JSON.parse($.global.__ALL2HTML_AE_PANEL_SETTINGS__);
    } catch (e) {
      return {};
    }
  }

  function getOverlayPrefix(config, panelSettings) {
    return (
      (panelSettings && panelSettings.overlayPrefix) ||
      (config && config.settings && config.settings.overlayPrefix) ||
      DEFAULT_OVERLAY_PREFIX
    );
  }

  function trimString(value) {
    return String(value || "").replace(/^\s+|\s+$/g, "");
  }

  function getOptionalSetting(config, panelSettings, key) {
    var panelValue = trimString(panelSettings && panelSettings[key]);
    if (panelValue) return panelValue;

    var configValue = trimString(config && config.settings && config.settings[key]);
    return configValue || "";
  }

  function normalizeFolderPath(path) {
    var normalized = String(path || "");
    if (normalized === "/" || normalized === "\\") return normalized;
    if (/^[A-Za-z]:[\\\/]?$/.test(normalized)) return normalized.charAt(0) + ":/";
    return normalized.replace(/[\\\/]+$/, "");
  }

  function isAbsolutePath(path) {
    return /^(\/|~\/|[A-Za-z]:[\\\/]|\\\\)/.test(String(path || ""));
  }

  function getCompIdentifier(comp) {
    try {
      if (comp && comp.id !== undefined && comp.id !== null) {
        return String(comp.id);
      }
    } catch (e) {}
    return String(comp && comp.index ? comp.index : "");
  }

  function findCompById(targetCompId) {
    if (!targetCompId || !app.project) return null;
    var i;
    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (!(item instanceof CompItem)) continue;
      if (getCompIdentifier(item) === String(targetCompId)) {
        return item;
      }
    }
    return null;
  }

  function getFontSourceName(fontEntry) {
    if (!fontEntry) return "";
    return String(fontEntry.sourceFont || fontEntry.aifont || "");
  }

  function normalizeFontEntry(fontEntry) {
    var sourceFont = getFontSourceName(fontEntry);
    return {
      sourceFont: sourceFont,
      aifont: fontEntry && fontEntry.aifont ? String(fontEntry.aifont) : sourceFont,
      family: fontEntry && fontEntry.family ? String(fontEntry.family) : "",
      weight: fontEntry && fontEntry.weight ? String(fontEntry.weight) : "",
      style: fontEntry && fontEntry.style ? String(fontEntry.style) : "",
      vshift: fontEntry && fontEntry.vshift ? String(fontEntry.vshift) : ""
    };
  }

  function mergeFontEntries(target, incoming) {
    var i;
    for (i = 0; i < incoming.length; i += 1) {
      var normalized = normalizeFontEntry(incoming[i]);
      var sourceFont = getFontSourceName(normalized);
      if (!sourceFont) continue;

      var replaced = false;
      var j;
      for (j = 0; j < target.length; j += 1) {
        if (getFontSourceName(target[j]) === sourceFont) {
          target[j] = normalized;
          replaced = true;
          break;
        }
      }
      if (!replaced) {
        target.push(normalized);
      }
    }
  }

  function loadFontMappings(config) {
    var merged = [];
    if (config && config.fonts && config.fonts.length) {
      mergeFontEntries(merged, config.fonts);
    }

    if ($.global && $.global.__ALL2HTML_PANEL_FONTS__) {
      try {
        var panelFonts = JSON.parse($.global.__ALL2HTML_PANEL_FONTS__);
        if (panelFonts && panelFonts.length) {
          mergeFontEntries(merged, panelFonts);
        }
      } catch (e) {}
    }

    return merged;
  }

  function getGoogleFontsMode(config, panelSettings) {
    var value =
      (panelSettings && (panelSettings.googleFonts || panelSettings.google_fonts)) ||
      (config && config.settings && (config.settings.googleFonts || config.settings.google_fonts)) ||
      "none";
    value = String(value || "none");
    return value === "import" || value === "link" ? value : "none";
  }

  function stripWrappingQuotes(value) {
    var trimmed = String(value || "").replace(/^\s+|\s+$/g, "");
    if (trimmed.length < 2) return trimmed;
    var first = trimmed.charAt(0);
    var last = trimmed.charAt(trimmed.length - 1);
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return trimmed.substring(1, trimmed.length - 1).replace(/\\(["'])/g, "$1");
    }
    return trimmed;
  }

  function getPrimaryCssFamily(cssFamily) {
    var value = String(cssFamily || "");
    var quote = "";
    var start = 0;
    var i;
    for (i = 0; i < value.length; i += 1) {
      var chr = value.charAt(i);
      if (quote) {
        if (chr === "\\" && i + 1 < value.length) {
          i += 1;
          continue;
        }
        if (chr === quote) quote = "";
        continue;
      }
      if (chr === "'" || chr === '"') {
        quote = chr;
        continue;
      }
      if (chr === ",") {
        var family = stripWrappingQuotes(value.substring(start, i));
        if (family && !isSkippedGoogleFontFamily(family)) return family;
        start = i + 1;
      }
    }
    var lastFamily = stripWrappingQuotes(value.substring(start));
    return lastFamily && !isSkippedGoogleFontFamily(lastFamily) ? lastFamily : "";
  }

  function isSkippedGoogleFontFamily(family) {
    var normalized = String(family || "").replace(/^\s+|\s+$/g, "").toLowerCase();
    var skipped = [
      "arial",
      "arial black",
      "avenir",
      "avenir next",
      "blinkmacsystemfont",
      "calibri",
      "cambria",
      "candara",
      "comic sans ms",
      "consolas",
      "courier",
      "courier new",
      "didot",
      "fantasy",
      "futura",
      "garamond",
      "geneva",
      "georgia",
      "gill sans",
      "helvetica",
      "helvetica neue",
      "impact",
      "menlo",
      "monaco",
      "monospace",
      "optima",
      "palatino",
      "sans",
      "sans-serif",
      "serif",
      "system-ui",
      "tahoma",
      "times",
      "times new roman",
      "trebuchet ms",
      "ui-monospace",
      "ui-rounded",
      "ui-sans-serif",
      "ui-serif",
      "verdana",
      "-apple-system"
    ];
    var i;
    if (!normalized || normalized.indexOf("var(") === 0) return true;
    for (i = 0; i < skipped.length; i += 1) {
      if (normalized === skipped[i]) return true;
    }
    return false;
  }

  function normalizeGoogleFontWeight(weight) {
    var normalized = String(weight || "").replace(/^\s+|\s+$/g, "").toLowerCase();
    if (!normalized || normalized === "normal" || normalized === "regular") return "400";
    if (normalized === "bold") return "700";
    var parsed = parseInt(normalized, 10);
    if (isNaN(parsed)) return "400";
    parsed = Math.round(parsed / 100) * 100;
    if (parsed < 100) parsed = 100;
    if (parsed > 900) parsed = 900;
    return String(parsed);
  }

  function addUnique(values, value) {
    var i;
    for (i = 0; i < values.length; i += 1) {
      if (values[i] === value) return;
    }
    values.push(value);
  }

  function findGoogleFontRequest(requests, family) {
    var i;
    for (i = 0; i < requests.length; i += 1) {
      if (requests[i].family === family) return requests[i];
    }
    return null;
  }

  function compareWeights(a, b) {
    return parseInt(a, 10) - parseInt(b, 10);
  }

  function encodeGoogleFontFamily(family) {
    return encodeURIComponent(family).replace(/%20/g, "+");
  }

  function buildGoogleFontsUrl(fontMappings) {
    var requests = [];
    var i;

    for (i = 0; i < fontMappings.length; i += 1) {
      var family = getPrimaryCssFamily(fontMappings[i].family);
      if (!family) continue;

      var request = findGoogleFontRequest(requests, family);
      if (!request) {
        request = { family: family, normalWeights: [], italicWeights: [] };
        requests.push(request);
      }

      var weight = normalizeGoogleFontWeight(fontMappings[i].weight);
      if (/italic|oblique/i.test(String(fontMappings[i].style || ""))) {
        addUnique(request.italicWeights, weight);
      } else {
        addUnique(request.normalWeights, weight);
      }
    }

    if (requests.length === 0) return "";

    var params = [];
    for (i = 0; i < requests.length; i += 1) {
      var r = requests[i];
      r.normalWeights.sort(compareWeights);
      r.italicWeights.sort(compareWeights);
      var familyParam = "family=" + encodeGoogleFontFamily(r.family);
      if (r.italicWeights.length === 0) {
        var normalWeights = r.normalWeights.length > 0 ? r.normalWeights : ["400"];
        familyParam += ":wght@" + normalWeights.join(";");
      } else {
        var pairs = [];
        var j;
        for (j = 0; j < r.normalWeights.length; j += 1) {
          pairs.push("0," + r.normalWeights[j]);
        }
        for (j = 0; j < r.italicWeights.length; j += 1) {
          pairs.push("1," + r.italicWeights[j]);
        }
        familyParam += ":ital,wght@" + pairs.join(";");
      }
      params.push(familyParam);
    }
    params.push("display=swap");
    return "https://fonts.googleapis.com/css2?" + params.join("&");
  }

  function escapeHtmlAttr(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function buildGoogleFontMarkup(mode, fontMappings) {
    var url = mode === "none" ? "" : buildGoogleFontsUrl(fontMappings || []);
    if (!url) return { links: "", importCss: "" };
    if (mode === "import") {
      return { links: "", importCss: '@import url("' + url + '");' };
    }
    return {
      links:
        '<link data-all2html-google-fonts="true" rel="preconnect" href="https://fonts.googleapis.com">\n' +
        '<link data-all2html-google-fonts="true" rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
        '<link data-all2html-google-fonts="true" rel="stylesheet" href="' +
        escapeHtmlAttr(url) +
        '">',
      importCss: ""
    };
  }

  function findFontMapping(fontMappings, sourceFont) {
    var i;
    for (i = 0; i < fontMappings.length; i += 1) {
      if (getFontSourceName(fontMappings[i]) === sourceFont) {
        return fontMappings[i];
      }
    }
    return null;
  }

  function buildTextStyle(textDocument, fontMappings) {
    var sourceFont = String(textDocument.font || "Arial");
    var mappedFont = findFontMapping(fontMappings || [], sourceFont);
    return {
      fontFamily: mappedFont && mappedFont.family ? mappedFont.family : sourceFont,
      fontSize: round4(Number(textDocument.fontSize || 16)),
      fontWeight: mappedFont && mappedFont.weight ? mappedFont.weight : guessWeight(textDocument),
      fontStyle: mappedFont && mappedFont.style ? mappedFont.style : guessFontStyle(textDocument),
      color: asRgbString(textDocument.fillColor),
      textAlign: guessTextAlign(textDocument)
    };
  }

  function buildStaticAnchor(layer, time, comp) {
    var transformGroup = layer.property("ADBE Transform Group");
    var anchorProp = getProperty(transformGroup, "ADBE Anchor Point");
    var anchor = anchorProp ? toArray(anchorProp.valueAtTime(time, false)) : [0, 0];
    var rect = layer.sourceRectAtTime(time, false);
    if (!rect || !rect.width || !rect.height) return [0, 0];

    var x = (anchor[0] - rect.left) / rect.width;
    var y = (anchor[1] - rect.top) / rect.height;

    return [round4(x), round4(y)];
  }

  function sampleOverlayLayer(layer, comp, fps, fontMappings) {
    var displayStartTime = Number(comp.displayStartTime || 0);
    var start = secondsToStartFrame(layer.inPoint - displayStartTime, fps);
    var end = secondsToEndFrame(layer.outPoint - displayStartTime, fps);
    if (end < start) end = start;

    var transformGroup = layer.property("ADBE Transform Group");
    var positionProp = getProperty(transformGroup, "ADBE Position");
    var opacityProp = getProperty(transformGroup, "ADBE Opacity");
    var scaleProp = getProperty(transformGroup, "ADBE Scale");
    var rotationProp =
      getProperty(transformGroup, "ADBE Rotate Z") || getProperty(transformGroup, "ADBE Rotation");
    var textDocProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var startTime = sampleTimeForFrame(start, fps, displayStartTime);
    var textDocument = textDocProp.valueAtTime(startTime, false);
    var scaleValue = scaleProp ? toArray(scaleProp.valueAtTime(startTime, false)) : [100, 100];
    var layerId = safeCompName(layer.name) + "|" + layer.index;

    var pos = [];
    var opacity = [];
    var frame;
    for (frame = start; frame <= end; frame += 1) {
      var t = sampleTimeForFrame(frame, fps, displayStartTime);
      var p = positionProp ? toArray(positionProp.valueAtTime(t, false)) : [0, 0];
      var o = opacityProp ? Number(opacityProp.valueAtTime(t, false)) : 100;
      pos.push([round4(p[0] / comp.width), round4(p[1] / comp.height)]);
      opacity.push(round4(clamp01(o / 100)));
    }

    return {
      id: layerId,
      data: {
        start: start,
        end: end,
        type: "text",
        text: {
          content: String(textDocument.text || ""),
          altText: String(textDocument.text || ""),
          style: buildTextStyle(textDocument, fontMappings)
        },
        "static": {
          anchor: buildStaticAnchor(layer, startTime, comp),
          scale: [round4(scaleValue[0] / 100), round4(scaleValue[1] / 100)],
          rot: rotationProp ? round4(Number(rotationProp.valueAtTime(startTime, false))) : 0
        },
        animatedTransforms: ["pos", "opacity"],
        pos: pos,
        opacity: opacity
      }
    };
  }

  function validateModel(model) {
    if (!model.stage || model.stage.frameRate <= 0) fail("frameRate must be greater than 0.");
    if (!model.stage.frameLength || model.stage.frameLength <= 0)
      fail("frameLength must be greater than 0.");
    if (!model.media || !model.media.src) fail("media.src is required.");

    var name;
    for (name in model.layers) {
      if (!model.layers.hasOwnProperty(name)) continue;
      var layer = model.layers[name];
      if (layer.start > layer.end) fail('Layer "' + name + '" has start > end.');
      var expected = layer.end - layer.start + 1;
      var transforms = layer.animatedTransforms || [];
      var i;
      for (i = 0; i < transforms.length; i += 1) {
        var prop = transforms[i];
        var values = layer[prop];
        if (!values || values.length !== expected) {
          fail(
            'Layer "' +
              name +
              '" property "' +
              prop +
              '" has invalid sample length. Expected ' +
              expected +
              "."
          );
        }
      }
    }
  }

  function choosePosterFrame(frameLength) {
    if (!frameLength || frameLength <= 1) return 0;
    var lastFrame = frameLength - 1;
    var frame = Math.floor(lastFrame * DEFAULT_POSTER_FRAME_RATIO);
    if (frame < 1) frame = 1;
    if (frame > lastFrame) frame = lastFrame;
    return frame;
  }

  function buildModel(comp, videoFileName, fontMappings, overlayPrefix) {
    var fps = Number(comp.frameRate);
    var frameLength = Math.max(1, Math.ceil(Number(comp.duration) * fps));
    var model = {
      stage: {
        width: comp.width,
        height: comp.height,
        frameRate: fps,
        frameLength: frameLength
      },
      media: {
        kind: "video",
        src: "./" + videoFileName,
        poster: null,
        posterFrame: choosePosterFrame(frameLength)
      },
      layers: {}
    };

    var i;
    for (i = 1; i <= comp.numLayers; i += 1) {
      var layer = comp.layer(i);
      if (!layer || !layer.enabled || layer.guideLayer) continue;
      if (!isTextLayer(layer)) continue;
      if (!startsWithOverlay(layer.name, overlayPrefix)) continue;
      var sampled = sampleOverlayLayer(layer, comp, fps, fontMappings);
      model.layers[sampled.id] = sampled.data;
    }

    validateModel(model);
    return model;
  }

  function resolveOutputTemplate(outputModule, preferredTemplate, candidates) {
    var templates = outputModule.templates || [];
    var i;
    var j;

    if (preferredTemplate) {
      for (j = 0; j < templates.length; j += 1) {
        if (String(templates[j]).toLowerCase() === String(preferredTemplate).toLowerCase()) {
          return {
            template: templates[j],
            error: null
          };
        }
      }
      return {
        template: null,
        error:
          'Selected output-module template "' +
          preferredTemplate +
          '" is not available in this After Effects install.'
      };
    }

    for (i = 0; i < candidates.length; i += 1) {
      for (j = 0; j < templates.length; j += 1) {
        if (String(templates[j]).toLowerCase() === String(candidates[i]).toLowerCase()) {
          return {
            template: templates[j],
            error: null
          };
        }
      }
    }

    return {
      template: null,
      error: null
    };
  }

  function disableExistingQueueItems() {
    var rq = app.project.renderQueue;
    var states = [];
    var i;
    for (i = 1; i <= rq.numItems; i += 1) {
      var item = rq.item(i);
      states.push({
        item: item,
        render: item.render
      });
      try {
        item.render = false;
      } catch (e) {}
    }
    return states;
  }

  function restoreQueueItems(states) {
    var i;
    for (i = 0; i < states.length; i += 1) {
      try {
        states[i].item.render = states[i].render;
      } catch (e) {}
    }
  }

  function removeRenderQueueItem(item) {
    if (!item) return;
    try {
      item.remove();
    } catch (e) {}
  }

  function buildMediaRenderComp(comp, overlayPrefix) {
    var renderComp = comp.duplicate();
    renderComp.name = comp.name + "__media-render";

    var i;
    for (i = 1; i <= renderComp.numLayers; i += 1) {
      var layer = renderComp.layer(i);
      if (!layer) continue;
      if (!isTextLayer(layer)) continue;
      if (!startsWithOverlay(layer.name, overlayPrefix)) continue;
      layer.enabled = false;
    }

    return renderComp;
  }

  function listFiles(folderPath) {
    var folder = new Folder(folderPath);
    if (!folder.exists) return [];

    var entries = folder.getFiles();
    var files = [];
    var i;
    for (i = 0; i < entries.length; i += 1) {
      if (entries[i] instanceof Folder) continue;
      files.push(entries[i]);
    }
    return files;
  }

  function isPosterOutputFile(file, posterBaseName) {
    var name = basename(file && file.name);
    return name.indexOf(posterBaseName) === 0 && /\.(png|jpe?g)$/i.test(name);
  }

  function removePosterOutputs(folderPath, posterBaseName) {
    var files = listFiles(folderPath);
    var i;
    for (i = 0; i < files.length; i += 1) {
      if (!isPosterOutputFile(files[i], posterBaseName)) continue;
      try {
        files[i].remove();
      } catch (e) {}
    }
  }

  function findPosterOutput(folderPath, posterBaseName) {
    var files = listFiles(folderPath);
    var i;
    for (i = 0; i < files.length; i += 1) {
      if (isPosterOutputFile(files[i], posterBaseName)) return files[i];
    }
    return null;
  }

  function removeCompItem(comp) {
    if (!comp) return;
    try {
      comp.remove();
    } catch (e) {}
  }

  function renderVideo(comp, outputPath, overlayPrefix, preferredTemplate) {
    var rq = app.project.renderQueue;
    var queueStates = disableExistingQueueItems();
    var renderComp = buildMediaRenderComp(comp, overlayPrefix);
    var rqItem = rq.items.add(renderComp);
    var outputModule = rqItem.outputModule(1);
    var resolvedTemplate = resolveOutputTemplate(
      outputModule,
      preferredTemplate,
      VIDEO_TEMPLATE_CANDIDATES
    );
    var outputFile = new File(outputPath);
    var mode = "render-queue";

    try {
      outputModule.file = outputFile;

      if (resolvedTemplate.error) {
        fail(resolvedTemplate.error);
      }

      if (resolvedTemplate.template) {
        outputModule.applyTemplate(resolvedTemplate.template);
        outputModule.file = outputFile;
        rqItem.render = true;
        rq.render();
        return {
          mode: mode,
          template: resolvedTemplate.template,
          rendered: outputFile.exists
        };
      }

      if (rq.canQueueInAME) {
        mode = "ame";
        rqItem.render = true;
        rq.queueInAME(true);
        return {
          mode: mode,
          template: null,
          rendered: false
        };
      }

      fail(
        "No local H.264 output template was found, and AE cannot queue this comp to AME. " +
          "Install or select an H.264-style output-module template, or enable Media Encoder."
      );
    } finally {
      removeRenderQueueItem(rqItem);
      removeCompItem(renderComp);
      restoreQueueItems(queueStates);
    }
  }

  function renderPoster(
    comp,
    outputFolder,
    posterBaseName,
    posterFrame,
    overlayPrefix,
    preferredTemplate
  ) {
    var rq = app.project.renderQueue;
    var queueStates = disableExistingQueueItems();
    removePosterOutputs(outputFolder, posterBaseName);

    var renderComp = buildMediaRenderComp(comp, overlayPrefix);
    var rqItem = rq.items.add(renderComp);
    var outputModule = rqItem.outputModule(1);
    var resolvedTemplate = resolveOutputTemplate(
      outputModule,
      preferredTemplate,
      POSTER_TEMPLATE_CANDIDATES
    );
    var posterTime = sampleTimeForFrame(
      posterFrame,
      Number(comp.frameRate),
      Number(comp.displayStartTime || 0)
    );
    var outputFile = new File(outputFolder + "/" + posterBaseName + ".png");

    if (resolvedTemplate.error) {
      removeRenderQueueItem(rqItem);
      removeCompItem(renderComp);
      restoreQueueItems(queueStates);
      return {
        mode: "render-queue",
        template: null,
        rendered: false,
        frame: posterFrame,
        time: round4(posterTime),
        path: null,
        name: null,
        error: resolvedTemplate.error
      };
    }

    if (!resolvedTemplate.template) {
      removeRenderQueueItem(rqItem);
      removeCompItem(renderComp);
      restoreQueueItems(queueStates);
      return {
        mode: "render-queue",
        template: null,
        rendered: false,
        frame: posterFrame,
        time: round4(posterTime),
        path: null,
        name: null
      };
    }

    try {
      outputModule.file = outputFile;
      outputModule.applyTemplate(resolvedTemplate.template);
      outputModule.file = outputFile;
      rqItem.timeSpanStart = posterTime;
      rqItem.timeSpanDuration =
        Number(comp.frameDuration || 0) || 1 / Math.max(1, Number(comp.frameRate));
      rqItem.render = true;
      rq.render();

      var posterFile = findPosterOutput(outputFolder, posterBaseName);
      var summary = {
        mode: "render-queue",
        template: resolvedTemplate.template,
        rendered: !!posterFile,
        frame: posterFrame,
        time: round4(posterTime),
        path: posterFile ? posterFile.fsName : null,
        name: posterFile ? posterFile.name : null
      };

      removeRenderQueueItem(rqItem);
      removeCompItem(renderComp);
      restoreQueueItems(queueStates);
      return summary;
    } catch (e) {
      removeRenderQueueItem(rqItem);
      removeCompItem(renderComp);
      restoreQueueItems(queueStates);
      return {
        mode: "render-queue",
        template: resolvedTemplate.template,
        rendered: false,
        frame: posterFrame,
        time: round4(posterTime),
        path: null,
        name: null,
        error: e && e.message ? String(e.message) : String(e)
      };
    }
  }

  function buildHtml(templatePath, model, googleFontsMode, fontMappings) {
    var template = EMBEDDED_PLAYER_TEMPLATE || readFile(templatePath);
    var json = escapeInlineJson(JSON.stringify(model, null, 2));
    var fontMarkup = buildGoogleFontMarkup(googleFontsMode, fontMappings || []);
    var hasLinkPlaceholder = template.indexOf("__GOOGLE_FONT_LINKS__") !== -1;
    var hasImportPlaceholder = template.indexOf("__GOOGLE_FONT_IMPORT__") !== -1;
    template = template.replace("__GOOGLE_FONT_LINKS__", fontMarkup.links);
    template = template.replace("__GOOGLE_FONT_IMPORT__", fontMarkup.importCss);

    if (!hasLinkPlaceholder && fontMarkup.links) {
      template = fontMarkup.links + "\n" + template;
    }
    if (!hasImportPlaceholder && fontMarkup.importCss) {
      if (template.indexOf("<style>") !== -1) {
        template = template.replace("<style>", "<style>\n" + fontMarkup.importCss);
      } else {
        template = "<style>\n" + fontMarkup.importCss + "\n</style>\n" + template;
      }
    }

    return template.replace("__MODEL_JSON__", json);
  }

  function getOutputRoot(config, panelSettings) {
    var projectFolder = getProjectFolder();
    var configured = getOptionalSetting(config, panelSettings, "outputRoot");
    if (!configured) {
      return projectFolder + "/all2html-ae-output";
    }

    if (isAbsolutePath(configured)) {
      return normalizeFolderPath(new Folder(configured).fsName);
    }

    return normalizeFolderPath(projectFolder + "/" + configured);
  }

  function getVideoTemplatePreference(config, panelSettings) {
    return getOptionalSetting(config, panelSettings, "videoTemplate");
  }

  function getPosterTemplatePreference(config, panelSettings) {
    return getOptionalSetting(config, panelSettings, "posterTemplate");
  }

  function setAutomatedResult(payload) {
    if (!ALL2HTML_AUTOMATED || !$.global) return;
    $.global.__ALL2HTML_RESULT__ = JSON.stringify(payload);
  }

  function exportActiveComp() {
    app.beginUndoGroup("all2html AE Export");

    try {
      logDiagnostic("info", "Starting After Effects export");
      var startedAt = new Date().getTime();
      var panelSettings = loadPanelSettings();
      var projectConfig = loadProjectConfig();
      var comp = findCompById(panelSettings.targetCompId) || app.project.activeItem;
      if (!comp || !(comp instanceof CompItem))
        fail("Please make a composition active before export.");
      var overlayPrefix = getOverlayPrefix(projectConfig, panelSettings);
      var outputRoot = getOutputRoot(projectConfig, panelSettings);
      var preferredVideoTemplate = getVideoTemplatePreference(projectConfig, panelSettings);
      var preferredPosterTemplate = getPosterTemplatePreference(projectConfig, panelSettings);
      var googleFontsMode = getGoogleFontsMode(projectConfig, panelSettings);

      var scriptFile = new File($.fileName);
      var baseFolder = scriptFile.parent.fsName;
      var slug = safeCompName(comp.name);
      var outFolder = outputRoot + "/" + slug;
      var templatePath = baseFolder + "/player-template.html";
      var videoName = slug + ".mp4";
      var posterBaseName = slug + "-poster";
      var jsonName = slug + ".json";
      var htmlName = slug + ".html";
      var summaryName = slug + "-summary.json";

      ensureFolder(outFolder);
      ensureJsonGlobal(baseFolder);

      var fontMappings = loadFontMappings(projectConfig);
      var model = buildModel(comp, videoName, fontMappings, overlayPrefix);
      var posterSummary = renderPoster(
        comp,
        outFolder,
        posterBaseName,
        model.media.posterFrame,
        overlayPrefix,
        preferredPosterTemplate
      );
      if (posterSummary.rendered && posterSummary.name) {
        model.media.poster = "./" + posterSummary.name;
      }

      writeFile(outFolder + "/" + jsonName, JSON.stringify(model, null, 2) + "\n");
      writeFile(outFolder + "/" + htmlName, buildHtml(templatePath, model, googleFontsMode, fontMappings));
      var renderSummary = renderVideo(
        comp,
        outFolder + "/" + videoName,
        overlayPrefix,
        preferredVideoTemplate
      );
      var summary = {
        slug: slug,
        outputFolder: outFolder,
        video: {
          path: outFolder + "/" + videoName,
          mode: renderSummary.mode,
          template: renderSummary.template,
          rendered: renderSummary.rendered
        },
        poster: {
          path: posterSummary.path,
          name: posterSummary.name,
          frame: posterSummary.frame,
          time: posterSummary.time,
          template: posterSummary.template,
          rendered: posterSummary.rendered,
          error: posterSummary.error || null
        },
        json: outFolder + "/" + jsonName,
        html: outFolder + "/" + htmlName,
        overlayCount: countOwnKeys(model.layers)
      };

      writeFile(outFolder + "/" + summaryName, JSON.stringify(summary, null, 2) + "\n");
      setAutomatedResult({
        success: true,
        outputPath: outFolder,
        slug: slug,
        overlayCount: summary.overlayCount,
        elapsed: round4((new Date().getTime() - startedAt) / 1000) + "s",
        compName: comp.name,
        videoMode: renderSummary.mode,
        videoRendered: renderSummary.rendered,
        videoTemplate: renderSummary.template,
        posterTemplate: posterSummary.template,
        posterRendered: posterSummary.rendered,
        posterPath: posterSummary.path,
        posterError: posterSummary.error || null,
        summaryPath: outFolder + "/" + summaryName,
        htmlPath: outFolder + "/" + htmlName,
        jsonPath: outFolder + "/" + jsonName,
        videoPath: outFolder + "/" + videoName
      });
      logDiagnostic("info", "After Effects export finished", outFolder);
    } catch (e) {
      setAutomatedResult({
        success: false,
        error: String(e)
      });
      throw e;
    } finally {
      app.endUndoGroup();
    }
  }

  exportActiveComp();
})();
