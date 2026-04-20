type FontConfigEntry = {
  sourceFont?: string;
  aifont?: string;
};

function parseFontConfigEntries(
  configFontsInput: string | FontConfigEntry[],
): FontConfigEntry[] {
  var parsed = configFontsInput;

  for (var depth = 0; depth < 2 && typeof parsed === "string"; depth += 1) {
    try {
      parsed = JSON.parse(parsed);
    } catch (e) {
      return [];
    }
  }

  if (!(parsed instanceof Array)) {
    return [];
  }

  return parsed;
}

function buildConfiguredFontLookup(
  configFontsInput: string | FontConfigEntry[],
): { [name: string]: boolean } {
  var configFonts = parseFontConfigEntries(configFontsInput);
  var configured: { [name: string]: boolean } = {};

  for (var i = 0; i < configFonts.length; i += 1) {
    var sourceFont = configFonts[i].sourceFont || configFonts[i].aifont;
    if (sourceFont) {
      configured[String(sourceFont)] = true;
    }
  }

  return configured;
}

function findMissingConfiguredFonts(
  detectedFonts: string[],
  configFontsInput: string | FontConfigEntry[],
): string[] {
  var configured = buildConfiguredFontLookup(configFontsInput);
  var missing: string[] = [];

  for (var i = 0; i < detectedFonts.length; i += 1) {
    if (!configured[detectedFonts[i]]) {
      missing.push(detectedFonts[i]);
    }
  }

  return missing;
}

export {
  buildConfiguredFontLookup,
  findMissingConfiguredFonts,
  parseFontConfigEntries,
};
