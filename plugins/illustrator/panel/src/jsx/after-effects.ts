/**
 * After Effects helpers for the shared CEP panel hostscript.
 */

import { findMissingConfiguredFonts } from "./font-config";

function stripJsonComments(content: string): string {
  var result = "";
  var inString = false;
  var inLineComment = false;
  var inBlockComment = false;
  var escapeNext = false;

  for (var i = 0; i < content.length; i += 1) {
    var ch = content.charAt(i);
    var next = content.charAt(i + 1);

    if (inLineComment) {
      if (ch === "\n" || ch === "\r") {
        inLineComment = false;
        result += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      result += ch;
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    result += ch;
  }

  return result;
}

function aeGetProjectFile(): File | null {
  try {
    return app.project && app.project.file ? app.project.file : null;
  } catch (e) {
    return null;
  }
}

function aeGetProjectFolder(): Folder | null {
  var projectFile = aeGetProjectFile();
  return projectFile && projectFile.parent ? projectFile.parent : null;
}

function aeGetProjectConfigPath(): string | null {
  var folder = aeGetProjectFolder();
  return folder ? folder.fsName + "/all2html-ae.config.json" : null;
}

function aeIsTextLayer(layer: Layer): boolean {
  return !!layer && layer.matchName === "ADBE Text Layer";
}

function aeGetCompIdentifier(comp: CompItem): string {
  try {
    if ((comp as any).id !== undefined && (comp as any).id !== null) {
      return String((comp as any).id);
    }
  } catch (e) {}
  return String(comp.index);
}

function aeGetActiveComp(): CompItem | null {
  try {
    var item = app.project.activeItem;
    if (item && item instanceof CompItem) {
      return item;
    }
  } catch (e) {}
  return null;
}

function aeFindCompById(compId: string | null): CompItem | null {
  if (!compId) return null;
  try {
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (!(item instanceof CompItem)) continue;
      if (aeGetCompIdentifier(item) === String(compId)) {
        return item;
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Explicit comp targeting, same rule as the exporter: a supplied compId is
 * honored or the call fails with an error naming it; only an absent compId
 * falls back to the active comp, and no active comp is also a failure. Falling
 * back silently after a delete/rename would answer for the wrong comp.
 */
function aeResolveTargetComp(compId: string | null): CompItem {
  if (compId) {
    var target = aeFindCompById(compId);
    if (!target) {
      throw new Error(
        'The selected composition (id "' +
          compId +
          '") was not found in this project. Re-select a composition in the panel.',
      );
    }
    return target;
  }

  var active = aeGetActiveComp();
  if (!active) {
    throw new Error("No composition is active in After Effects.");
  }
  return active;
}

function aeListOutputModuleTemplates(compId: string | null): {
  outputModuleTemplates: string[];
  canQueueInAME: boolean;
} {
  var comp = aeResolveTargetComp(compId);

  var rqItem = null;
  try {
    rqItem = app.project.renderQueue.items.add(comp);
    var outputModule = rqItem.outputModule(1);
    var templates = outputModule && outputModule.templates ? outputModule.templates : [];
    var names: string[] = [];
    var seen: { [name: string]: boolean } = {};
    for (var i = 0; i < templates.length; i += 1) {
      var name = String(templates[i] || "");
      if (!name || seen[name]) continue;
      seen[name] = true;
      names.push(name);
    }
    names.sort();
    return {
      outputModuleTemplates: names,
      canQueueInAME: !!app.project.renderQueue.canQueueInAME,
    };
  } catch (e) {
    return {
      outputModuleTemplates: [],
      canQueueInAME: !!(
        app.project &&
        app.project.renderQueue &&
        app.project.renderQueue.canQueueInAME
      ),
    };
  } finally {
    if (rqItem) {
      try {
        rqItem.remove();
      } catch (e) {}
    }
  }
}

function aeListComps(): Array<{
  id: string;
  name: string;
  width: number;
  height: number;
  duration: number;
  frameRate: number;
}> {
  var comps = [];
  try {
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (!(item instanceof CompItem)) continue;
      comps.push({
        id: aeGetCompIdentifier(item),
        name: item.name,
        width: item.width,
        height: item.height,
        duration: item.duration,
        frameRate: item.frameRate,
      });
    }
  } catch (e) {}
  return comps;
}

function aeGetProjectInfo(): {
  name: string;
  path: string;
  saved: boolean;
  compCount: number;
  activeCompId: string | null;
  activeCompName: string | null;
} {
  var projectFile = aeGetProjectFile();
  var activeComp = aeGetActiveComp();
  var comps = aeListComps();
  return {
    name: projectFile ? projectFile.name : "Untitled Project",
    path: projectFile ? projectFile.fsName : "",
    saved: !!projectFile,
    compCount: comps.length,
    activeCompId: activeComp ? aeGetCompIdentifier(activeComp) : null,
    activeCompName: activeComp ? activeComp.name : null,
  };
}

function aeReadConfigFile(): string {
  try {
    var configPath = aeGetProjectConfigPath();
    if (!configPath) return "null";
    var file = new File(configPath);
    if (!file.exists) return "null";
    file.open("r");
    file.encoding = "UTF-8";
    var content = file.read();
    file.close();
    return stripJsonComments(content);
  } catch (e) {
    return "null";
  }
}

function aeSaveConfigFile(configJson: string): string {
  try {
    var configPath = aeGetProjectConfigPath();
    if (!configPath) {
      return JSON.stringify({ success: false, error: "Save the After Effects project first." });
    }
    var file = new File(configPath);
    file.open("w");
    file.encoding = "UTF-8";
    file.write(configJson);
    file.close();
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
}

function aeCollectCompFonts(compId: string | null): string[] {
  var comp = aeResolveTargetComp(compId);

  var fontSet: { [name: string]: boolean } = {};

  for (var i = 1; i <= comp.numLayers; i += 1) {
    var layer = comp.layer(i);
    if (!aeIsTextLayer(layer)) continue;
    try {
      var textDocProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
      var sampleTime = Math.max(layer.inPoint || 0, comp.displayStartTime || 0);
      var textDocument = textDocProp.valueAtTime(sampleTime, false);
      var fontName = String(textDocument.font || "");
      if (fontName) {
        fontSet[fontName] = true;
      }
    } catch (e) {
      // ignore inaccessible text layers
    }
  }

  var names = [];
  for (var key in fontSet) {
    // ExtendScript is an ES3-era runtime: no Object.hasOwn, no Object.keys.
    if (Object.prototype.hasOwnProperty.call(fontSet, key)) names.push(key);
  }
  names.sort();
  return names;
}

function aeFindMissingFonts(
  configFontsInput: string | Array<{ sourceFont?: string; aifont?: string }>,
  compId: string | null,
): string[] {
  var docFonts = aeCollectCompFonts(compId);
  return findMissingConfiguredFonts(docFonts, configFontsInput);
}

export {
  aeFindMissingFonts,
  aeGetProjectInfo,
  aeListComps,
  aeListOutputModuleTemplates,
  aeReadConfigFile,
  aeSaveConfigFile,
};
