/* eslint-disable no-undef */
(function () {
  var OVERLAY_PREFIX = "overlay:";
  var VIDEO_TEMPLATE_CANDIDATES = [
    "H.264",
    "H.264 - Match Render Settings - 15 Mbps",
    "H.264 - Match Render Settings - 40 Mbps",
    "MP4"
  ];
  var POSTER_TEMPLATE_CANDIDATES = ["PNG Sequence with Alpha", "PNG Sequence", "JPEG Sequence"];
  var DEFAULT_POSTER_FRAME_RATIO = 0.15;

  function fail(message) {
    throw new Error("[ae-prototype] " + message);
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

  function startsWithOverlay(name) {
    return String(name || "").indexOf(OVERLAY_PREFIX) === 0;
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

  function buildTextStyle(textDocument) {
    return {
      fontFamily: String(textDocument.font || "Arial"),
      fontSize: round4(Number(textDocument.fontSize || 16)),
      fontWeight: guessWeight(textDocument),
      fontStyle: guessFontStyle(textDocument),
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

  function sampleOverlayLayer(layer, comp, fps) {
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
          style: buildTextStyle(textDocument)
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

  function buildModel(comp, videoFileName) {
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
      if (!startsWithOverlay(layer.name)) continue;
      var sampled = sampleOverlayLayer(layer, comp, fps);
      model.layers[sampled.id] = sampled.data;
    }

    validateModel(model);
    return model;
  }

  function chooseOutputTemplate(outputModule, candidates) {
    var templates = outputModule.templates || [];
    var i;
    var j;

    for (i = 0; i < candidates.length; i += 1) {
      for (j = 0; j < templates.length; j += 1) {
        if (String(templates[j]).toLowerCase() === String(candidates[i]).toLowerCase()) {
          return templates[j];
        }
      }
    }

    return null;
  }

  function clearQueuedItems() {
    var rq = app.project.renderQueue;
    var i;
    for (i = rq.numItems; i >= 1; i -= 1) {
      try {
        rq.item(i).remove();
      } catch (e) {}
    }
  }

  function buildMediaRenderComp(comp) {
    var renderComp = comp.duplicate();
    renderComp.name = comp.name + "__media-render";

    var i;
    for (i = 1; i <= renderComp.numLayers; i += 1) {
      var layer = renderComp.layer(i);
      if (!layer) continue;
      if (!isTextLayer(layer)) continue;
      if (!startsWithOverlay(layer.name)) continue;
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

  function renderVideo(comp, outputPath) {
    var rq = app.project.renderQueue;
    clearQueuedItems();
    var renderComp = buildMediaRenderComp(comp);
    var rqItem = rq.items.add(renderComp);
    var outputModule = rqItem.outputModule(1);
    var templateName = chooseOutputTemplate(outputModule, VIDEO_TEMPLATE_CANDIDATES);
    var outputFile = new File(outputPath);
    var mode = "render-queue";

    outputModule.file = outputFile;

    if (templateName) {
      outputModule.applyTemplate(templateName);
      outputModule.file = outputFile;
      rqItem.render = true;
      rq.render();
      var queueSummary = {
        mode: mode,
        template: templateName,
        rendered: outputFile.exists
      };
      removeCompItem(renderComp);
      return queueSummary;
    }

    if (rq.canQueueInAME) {
      mode = "ame";
      rqItem.render = true;
      rq.queueInAME(true);
      var ameSummary = {
        mode: mode,
        template: null,
        rendered: false
      };
      removeCompItem(renderComp);
      return ameSummary;
    }

    removeCompItem(renderComp);

    fail(
      "No local H.264 output template was found, and AE cannot queue this comp to AME. " +
        "Install or select an H.264-style output-module template, or enable Media Encoder."
    );
  }

  function renderPoster(comp, outputFolder, posterBaseName, posterFrame) {
    var rq = app.project.renderQueue;
    clearQueuedItems();
    removePosterOutputs(outputFolder, posterBaseName);

    var renderComp = buildMediaRenderComp(comp);
    var rqItem = rq.items.add(renderComp);
    var outputModule = rqItem.outputModule(1);
    var templateName = chooseOutputTemplate(outputModule, POSTER_TEMPLATE_CANDIDATES);
    var posterTime = sampleTimeForFrame(
      posterFrame,
      Number(comp.frameRate),
      Number(comp.displayStartTime || 0)
    );
    var outputFile = new File(outputFolder + "/" + posterBaseName + ".png");

    if (!templateName) {
      removeCompItem(renderComp);
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
      outputModule.applyTemplate(templateName);
      outputModule.file = outputFile;
      rqItem.timeSpanStart = posterTime;
      rqItem.timeSpanDuration =
        Number(comp.frameDuration || 0) || 1 / Math.max(1, Number(comp.frameRate));
      rqItem.render = true;
      rq.render();

      var posterFile = findPosterOutput(outputFolder, posterBaseName);
      var summary = {
        mode: "render-queue",
        template: templateName,
        rendered: !!posterFile,
        frame: posterFrame,
        time: round4(posterTime),
        path: posterFile ? posterFile.fsName : null,
        name: posterFile ? posterFile.name : null
      };

      removeCompItem(renderComp);
      return summary;
    } catch (e) {
      removeCompItem(renderComp);
      return {
        mode: "render-queue",
        template: templateName,
        rendered: false,
        frame: posterFrame,
        time: round4(posterTime),
        path: null,
        name: null,
        error: e && e.message ? String(e.message) : String(e)
      };
    }
  }

  function buildHtml(templatePath, model) {
    var template = readFile(templatePath);
    var json = escapeInlineJson(JSON.stringify(model, null, 2));
    return template.replace("__MODEL_JSON__", json);
  }

  function exportActiveComp() {
    app.beginUndoGroup("AE Temporal Overlay Prototype");

    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) fail("Please make a composition active before export.");

    var scriptFile = new File($.fileName);
    var baseFolder = scriptFile.parent.fsName;
    var slug = safeCompName(comp.name);
    var outFolder = baseFolder + "/" + slug;
    var templatePath = baseFolder + "/player-template.html";
    var videoName = slug + ".mp4";
    var posterBaseName = slug + "-poster";
    var jsonName = slug + ".json";
    var htmlName = slug + ".html";
    var summaryName = slug + "-summary.json";

    ensureFolder(outFolder);
    ensureJsonGlobal(baseFolder);

    var model = buildModel(comp, videoName);
    var posterSummary = renderPoster(comp, outFolder, posterBaseName, model.media.posterFrame);
    if (posterSummary.rendered && posterSummary.name) {
      model.media.poster = "./" + posterSummary.name;
    }

    writeFile(outFolder + "/" + jsonName, JSON.stringify(model, null, 2) + "\n");
    writeFile(outFolder + "/" + htmlName, buildHtml(templatePath, model));
    var renderSummary = renderVideo(comp, outFolder + "/" + videoName);
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

    app.endUndoGroup();
  }

  exportActiveComp();
})();
