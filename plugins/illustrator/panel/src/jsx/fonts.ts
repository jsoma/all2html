/**
 * Font enumeration and missing font detection for the CEP panel.
 */

import { findMissingConfiguredFonts } from "./font-config";

/**
 * Collect unique font names used in all text frames of the active document.
 * Returns a sorted array of Illustrator font names (e.g., "ArialMT", "HelveticaNeue-Bold").
 */
function collectDocumentFonts(): string[] {
  var doc = app.activeDocument;
  var fontSet: { [name: string]: boolean } = {};

  for (var i = 0; i < doc.textFrames.length; i++) {
    var tf = doc.textFrames[i];
    try {
      for (var j = 0; j < tf.characters.length; j++) {
        var fontName = tf.characters[j].characterAttributes.textFont.name;
        fontSet[fontName] = true;
      }
    } catch (e) {
      // Skip inaccessible frames (locked layers, etc.)
    }
  }

  var names: string[] = [];
  for (var key in fontSet) {
    if (fontSet.hasOwnProperty(key)) {
      names.push(key);
    }
  }
  names.sort();
  return names;
}

function findMissingFonts(
  configFontsInput: string | Array<{ sourceFont?: string; aifont?: string }>,
): string[] {
  var docFonts = collectDocumentFonts();
  return findMissingConfiguredFonts(docFonts, configFontsInput);
}

export { collectDocumentFonts, findMissingFonts };
