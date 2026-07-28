import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

/**
 * The panel's doc-lock badge is driven by whether the host finds a settings
 * text block. It used to test `/^ai2html-settings\s*$/` only, while the
 * exporter had already widened to `SETTINGS_BLOCK_RXP =
 * /^(all2html|ai2html)-settings\s*$/`. A document governed by an
 * `all2html-settings` block therefore exported under a doc lock the panel never
 * showed — the badge said "yours to edit" about a field the export overrode.
 *
 * These tests run the *shipped* hostscript functions, lifted out of the file by
 * brace matching and stripped of their types, so a narrowing edit fails here
 * rather than in Illustrator. The exporter's own regex is read out of
 * `exporter.jsx` and required to be identical.
 */
const hostscriptPath = resolve(
  import.meta.dirname,
  "../../plugins/illustrator/panel/src/jsx/hostscript.ts",
);
/**
 * Types are stripped first, with the same tool the panel build uses, so the
 * extracted functions are the ones the host actually evaluates — and so brace
 * matching cannot trip over a `{ [key: string]: string }` return annotation.
 */
const hostscriptSource = transformSync(readFileSync(hostscriptPath, "utf-8"), {
  loader: "ts",
  format: "esm",
}).code;

const exporterSource = readFileSync(
  resolve(import.meta.dirname, "../../plugins/illustrator/exporter.jsx"),
  "utf-8",
);

/** Lift a top-level declaration out of the source by matching its braces. */
function extractBlock(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start === -1) throw new Error(`Could not find "${header}"`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unbalanced braces after "${header}"`);
}

function extractLine(source: string, pattern: RegExp): string {
  const match = source.match(pattern);
  if (!match) throw new Error(`Could not find ${pattern}`);
  return match[0];
}

interface FakeFrame {
  lines: Array<{ contents: string }>;
  contents: string;
}

interface SettingsBlockHost {
  setDocument(frames: FakeFrame[]): void;
  hasSettingsBlock(): boolean;
  readMergedSettingsBlocks(): Record<string, string>;
  settingsBlockRegexSource: string;
}

function loadSettingsBlockHost(): SettingsBlockHost {
  const code = [
    extractLine(hostscriptSource, /var PANEL_SETTINGS_BLOCK_RXP = \/.*\/;/),
    extractLine(hostscriptSource, /var PANEL_LEGACY_SETTINGS_HEADER = "[^"]*";/),
    extractBlock(hostscriptSource, "function trimHostString("),
    extractBlock(hostscriptSource, "function findSettingsBlockGroups("),
    extractBlock(hostscriptSource, "function findSettingsBlocks("),
    extractBlock(hostscriptSource, "function parseSettingsBlock("),
    extractBlock(hostscriptSource, "function readMergedSettingsBlocks("),
    extractBlock(hostscriptSource, "function mergeSettingsBlocksInto("),
  ].join("\n\n");

  const factory = new Function(`
    var app = { activeDocument: { textFrames: [] } };
    ${code}
    return {
      setDocument: function (frames) { app.activeDocument = { textFrames: frames }; },
      hasSettingsBlock: function () { return findSettingsBlocks().length > 0; },
      readMergedSettingsBlocks: readMergedSettingsBlocks,
      settingsBlockRegexSource: String(PANEL_SETTINGS_BLOCK_RXP)
    };
  `);
  return factory() as SettingsBlockHost;
}

/**
 * The exporter's own settings merge, lifted out of `exporter.jsx` the same way.
 *
 * `parseSpecialBlocks` is what actually governs an export, so the panel is held
 * against it rather than against a restatement of the rule. Only the parts of
 * the exporter's environment that the merge touches are supplied: an empty
 * artboard list (so no block is hidden), the warning sink, and the restore
 * pushers it calls when it does hide one.
 */
function loadExporterSettingsMerge(): (frames: FakeFrame[]) => Record<string, string> {
  const code = [
    "var warnings = [];",
    "var structuredWarnings = [];",
    "var unlockedObjectCount = 0;",
    "function pushRelockRestore() {}",
    "function pushUnhideRestore() {}",
    extractLine(exporterSource, /var LEGACY_BLOCK_PREFIX = "[^"]*";/),
    extractLine(exporterSource, /var SPECIAL_BLOCK_RXP = \/.*\/;/),
    extractBlock(exporterSource, "function warn("),
    extractBlock(exporterSource, "function trim("),
    extractBlock(exporterSource, "function straightenCurlyQuotes("),
    extractBlock(exporterSource, "function straightenCurlyQuotesInAngleBrackets("),
    extractBlock(exporterSource, "function objectIsHidden("),
    extractBlock(exporterSource, "function hasOwn("),
    extractBlock(exporterSource, "function blockOverlapsArtboard("),
    extractBlock(exporterSource, "function parseSpecialBlocks("),
  ].join("\n\n");

  const factory = new Function(`
    ${code}
    return function (frames) {
      return parseSpecialBlocks({ textFrames: frames, artboards: [] }).settings;
    };
  `);
  return factory() as (frames: FakeFrame[]) => Record<string, string>;
}

function frame(...lines: string[]): FakeFrame {
  return {
    lines: lines.map((contents) => ({ contents })),
    contents: lines.join("\r"),
  };
}

/** A text frame with no lines at all — `tf.lines[0]` throws in Illustrator. */
const emptyFrame: FakeFrame = {
  get lines(): Array<{ contents: string }> {
    throw new Error("no text");
  },
  contents: "",
};

describe("panel settings-block detection", () => {
  const host = loadSettingsBlockHost();

  it("uses the exporter's own settings-block regex", () => {
    const exporterRegex = exporterSource.match(/var SETTINGS_BLOCK_RXP = (\/.*\/);/);
    if (!exporterRegex) throw new Error("Could not find SETTINGS_BLOCK_RXP in exporter.jsx");
    expect(host.settingsBlockRegexSource).toBe(exporterRegex[1]);
  });

  it("detects both the canonical and the legacy settings block", () => {
    host.setDocument([frame("all2html-settings", "project_name: canonical")]);
    expect(host.hasSettingsBlock()).toBe(true);

    host.setDocument([frame("ai2html-settings", "project_name: legacy")]);
    expect(host.hasSettingsBlock()).toBe(true);

    host.setDocument([frame("all2html-css", "body {}")]);
    expect(host.hasSettingsBlock()).toBe(false);

    host.setDocument([]);
    expect(host.hasSettingsBlock()).toBe(false);
  });

  it("reads the canonical block, which the old regex missed entirely", () => {
    host.setDocument([frame("all2html-settings", "project_name: canonical", "max_width: 960")]);
    expect(host.readMergedSettingsBlocks()).toEqual({
      project_name: "canonical",
      max_width: "960",
    });
  });

  /**
   * `parseSpecialBlocks` in `exporter.jsx` merges both bags and lets
   * `all2html-` win key-by-key, order-independent, keeping uncontested
   * `ai2html-` keys. The panel has to report the same thing or the badges
   * describe a different document than the export uses.
   */
  it("matches the exporter precedence: all2html- wins key-by-key, legacy survives", () => {
    const canonical = frame("all2html-settings", "project_name: canonical", "max_width: 960");
    const legacy = frame("ai2html-settings", "project_name: legacy", "namespace: g-");

    host.setDocument([canonical, legacy]);
    expect(host.readMergedSettingsBlocks()).toEqual({
      project_name: "canonical",
      max_width: "960",
      namespace: "g-",
    });

    // Order-independent: text-frame order must not decide the winner.
    host.setDocument([legacy, canonical]);
    expect(host.readMergedSettingsBlocks()).toEqual({
      project_name: "canonical",
      max_width: "960",
      namespace: "g-",
    });
  });

  /**
   * The half the reverse-merge got wrong. Across prefixes the rule is
   * canonical-over-legacy; *within* a prefix the exporter assigns into one bag
   * in text-frame order, so the last duplicate wins. Iterating the flat
   * canonical-first list backwards inverted that, and the panel showed the first
   * block's values — and its `doc` lock badges — for an export governed by the
   * last one.
   */
  it("lets the last duplicate win inside each prefix, as the exporter does", () => {
    host.setDocument([
      frame("all2html-settings", "project_name: first-canonical", "max_width: 960"),
      frame("ai2html-settings", "project_name: first-legacy", "namespace: g1-"),
      frame("all2html-settings", "project_name: second-canonical"),
      frame("ai2html-settings", "namespace: g2-", "page_template: story"),
    ]);

    expect(host.readMergedSettingsBlocks()).toEqual({
      project_name: "second-canonical",
      max_width: "960",
      namespace: "g2-",
      page_template: "story",
    });
  });

  it("skips frames whose text cannot be read", () => {
    host.setDocument([emptyFrame, frame("all2html-settings", "project_name: canonical")]);
    expect(host.hasSettingsBlock()).toBe(true);
    expect(host.readMergedSettingsBlocks()).toEqual({ project_name: "canonical" });
  });

  it("returns nothing when the document carries no settings block", () => {
    host.setDocument([frame("just a label")]);
    expect(host.readMergedSettingsBlocks()).toEqual({});
  });
});

/**
 * The two implementations cannot literally share code: `exporter.jsx` is
 * hand-written ES3 concatenated into `all2html.js` with no module system, and
 * the hostscript answers `readSettingsBlock` without the core bundle loaded, so
 * neither a build-time import nor a runtime `All2Html.*` call reaches both. What
 * is available is a differential test: run the shipped `parseSpecialBlocks` and
 * the shipped `readMergedSettingsBlocks` over one document and require the same
 * bag. They have drifted twice now — first on the regex, then on duplicate
 * precedence — and both times only one side was edited.
 */
describe("the panel's merge equals the exporter's", () => {
  const host = loadSettingsBlockHost();
  const exporterMerge = loadExporterSettingsMerge();

  function expectAgreement(frames: FakeFrame[], expected: Record<string, string>): void {
    host.setDocument(frames);
    const panel = host.readMergedSettingsBlocks();
    // Fresh frames for the exporter: `parseSpecialBlocks` renames the frames it
    // reads, and a shared array would let one run observe the other's writes.
    expect(exporterMerge(frames.map((f) => ({ ...f })))).toEqual(expected);
    expect(panel).toEqual(expected);
  }

  it("agrees on a document carrying duplicates of both prefixes", () => {
    expectAgreement(
      [
        frame("all2html-settings", "project_name: first-canonical", "max_width: 960"),
        frame("ai2html-settings", "project_name: first-legacy", "namespace: g1-"),
        frame("all2html-settings", "project_name: second-canonical"),
        frame("ai2html-settings", "namespace: g2-", "page_template: story"),
      ],
      {
        project_name: "second-canonical",
        max_width: "960",
        namespace: "g2-",
        page_template: "story",
      },
    );
  });

  it("agrees when the legacy block comes first", () => {
    expectAgreement(
      [
        frame("ai2html-settings", "project_name: legacy", "namespace: g-"),
        frame("all2html-settings", "project_name: canonical"),
      ],
      { project_name: "canonical", namespace: "g-" },
    );
  });

  it("agrees when only duplicate legacy blocks exist", () => {
    expectAgreement(
      [
        frame("ai2html-settings", "project_name: one", "max_width: 640"),
        frame("ai2html-settings", "project_name: two"),
      ],
      { project_name: "two", max_width: "640" },
    );
  });

  it("agrees that a non-settings special block contributes nothing", () => {
    expectAgreement(
      [
        frame("all2html-css", "project_name: not-a-setting"),
        frame("all2html-settings", "project_name: canonical"),
      ],
      { project_name: "canonical" },
    );
  });
});
