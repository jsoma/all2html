import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A user of a product called all2html who names a text block `all2html-css` used
 * to get total silence: every block/layer matcher in `exporter.jsx` was anchored
 * to `^ai2html-`. These tests derive the matchers from the shipped ExtendScript
 * file rather than restating them, so a narrowing edit fails here instead of
 * failing in Illustrator.
 */
const exporterPath = resolve(import.meta.dirname, "../../plugins/illustrator/exporter.jsx");
const exporterSource = readFileSync(exporterPath, "utf-8");

function extract(pattern: RegExp): string {
  const match = exporterSource.match(pattern);
  if (!match) throw new Error(`Could not find ${pattern} in exporter.jsx`);
  return match[0];
}

const PREFIX_DECLARATIONS = [
  extract(/var LEGACY_BLOCK_PREFIX = "[^"]*";/),
  extract(/var SPECIAL_BLOCK_PREFIXES = \[[^\]]*\];/),
  extract(/var SPECIAL_BLOCK_RXP = \/.*\/;/),
  extract(/var SPECIAL_NAME_RXP = \/.*\/;/),
  extract(/var SETTINGS_BLOCK_RXP = \/.*\/;/),
].join("\n");

interface Matchers {
  LEGACY_BLOCK_PREFIX: string;
  SPECIAL_BLOCK_PREFIXES: string[];
  SPECIAL_BLOCK_RXP: RegExp;
  SPECIAL_NAME_RXP: RegExp;
  SETTINGS_BLOCK_RXP: RegExp;
}

function loadMatchers(): Matchers {
  const source = [
    PREFIX_DECLARATIONS,
    "return { LEGACY_BLOCK_PREFIX: LEGACY_BLOCK_PREFIX,",
    "  SPECIAL_BLOCK_PREFIXES: SPECIAL_BLOCK_PREFIXES,",
    "  SPECIAL_BLOCK_RXP: SPECIAL_BLOCK_RXP,",
    "  SPECIAL_NAME_RXP: SPECIAL_NAME_RXP,",
    "  SETTINGS_BLOCK_RXP: SETTINGS_BLOCK_RXP };",
  ].join("\n");
  return new Function(source)() as Matchers;
}

interface FakeFrame {
  lines: Array<{ contents: string }>;
  contents: string;
  name?: string;
  locked?: boolean;
  hidden?: boolean;
}

interface ParseResult {
  settings: Record<string, string>;
  customBlocks: Array<{ type: string; content: string }>;
}

/**
 * Runs the real `parseSpecialBlocks()` with the document-object surface stubbed,
 * so the precedence rule under test is the shipped code path.
 */
function loadParseSpecialBlocks(): (doc: { textFrames: FakeFrame[] }) => ParseResult {
  const source = [
    "var unlockedObjectCount = 0;",
    "var warnings = [];",
    "function warn(msg) { warnings.push(msg); }",
    "function trim(s) { return String(s).replace(/^\\s+|\\s+$/g, ''); }",
    "function straightenCurlyQuotes(s) { return s; }",
    "function straightenCurlyQuotesInAngleBrackets(s) { return s; }",
    "function objectIsHidden(tf) { return !!tf.hidden; }",
    "function blockOverlapsArtboard() { return false; }",
    "function pushRelockRestore() {}",
    "function pushUnhideRestore() {}",
    PREFIX_DECLARATIONS,
    extract(/function hasOwn\(obj, key\) \{[\s\S]*?\n\}/),
    extract(/function parseSpecialBlocks\(doc\) \{[\s\S]*?\n\}/),
    "return parseSpecialBlocks;",
  ].join("\n");
  return new Function(source)() as (doc: { textFrames: FakeFrame[] }) => ParseResult;
}

function frame(body: string, extra: Partial<FakeFrame> = {}): FakeFrame {
  const lines = body.split("\n");
  return {
    lines: lines.map((contents) => ({ contents })),
    contents: lines.join("\r"),
    ...extra,
  };
}

const BLOCK_TYPES = ["css", "js", "html", "settings", "text", "html-before", "html-after"];
const PREFIXES = ["all2html-", "ai2html-"];

describe("Illustrator block-name prefixes", () => {
  const m = loadMatchers();

  it("declares all2html- first and ai2html- as the legacy alias", () => {
    expect(m.SPECIAL_BLOCK_PREFIXES).toEqual(["all2html-", "ai2html-"]);
    expect(m.LEGACY_BLOCK_PREFIX).toBe("ai2html-");
  });

  it("matches every block type under both prefixes", () => {
    for (const type of BLOCK_TYPES) {
      for (const prefix of PREFIXES) {
        const match = m.SPECIAL_BLOCK_RXP.exec(prefix + type);
        expect(match, `${prefix}${type} must be recognized`).not.toBeNull();
        expect(`${match?.[1]}-`).toBe(prefix);
        expect(match?.[2]).toBe(type);
      }
    }
  });

  it("still tolerates trailing whitespace on the header line", () => {
    expect(m.SPECIAL_BLOCK_RXP.test("all2html-settings  ")).toBe(true);
    expect(m.SPECIAL_BLOCK_RXP.test("ai2html-settings\t")).toBe(true);
  });

  it("does not widen to unrelated names", () => {
    for (const name of [
      "all2htmlcss",
      "all2html-nope",
      "ai2html-nope",
      "my-all2html-css",
      "html-before",
      "",
    ]) {
      expect(m.SPECIAL_BLOCK_RXP.test(name), `${name} must not match`).toBe(false);
    }
  });

  it("recognizes special names and the settings block under both prefixes", () => {
    for (const prefix of PREFIXES) {
      expect(m.SPECIAL_NAME_RXP.test(`${prefix}css`)).toBe(true);
      expect(m.SPECIAL_NAME_RXP.test(`${prefix}settings`)).toBe(true);
      expect(m.SETTINGS_BLOCK_RXP.test(`${prefix}settings`)).toBe(true);
      expect(m.SETTINGS_BLOCK_RXP.test(`${prefix}settings `)).toBe(true);
      expect(m.SETTINGS_BLOCK_RXP.test(`${prefix}css`)).toBe(false);
    }
    expect(m.SPECIAL_NAME_RXP.test("artwork")).toBe(false);
    expect(m.SPECIAL_NAME_RXP.test("chart:svg")).toBe(false);
  });

  it("leaves no prefix matcher hard-coded to ai2html- alone", () => {
    // The exact shapes that used to live at the five match sites.
    expect(exporterSource).not.toContain('indexOf("ai2html-")');
    expect(exporterSource).not.toMatch(/\/\^ai2html-/);
    expect(exporterSource).not.toContain('=== "ai2html-settings"');
    expect(exporterSource).not.toContain('getByName("ai2html-settings")');
    // The config-filename fallback already accepted both spellings; keep it.
    expect(exporterSource).toContain('docPath + "all2html.config.json"');
    expect(exporterSource).toContain('docPath + "ai2html-config.json"');
  });
});

describe("Illustrator parseSpecialBlocks", () => {
  const parseSpecialBlocks = loadParseSpecialBlocks();

  it("reads settings and custom blocks under both prefixes", () => {
    for (const prefix of PREFIXES) {
      const result = parseSpecialBlocks({
        textFrames: [
          frame(`${prefix}settings\nimage_format: png\nproject_name: demo`),
          frame(`${prefix}css\n.g-body { color: red; }`),
          frame(`${prefix}js\nconsole.log(1);`),
        ],
      });
      expect(result.settings).toEqual({ image_format: "png", project_name: "demo" });
      expect(result.customBlocks.map((b) => b.type)).toEqual(["css", "js"]);
    }
  });

  it("names the settings frame with the spelling the user typed", () => {
    for (const prefix of PREFIXES) {
      const tf = frame(`${prefix}settings\nimage_format: png`);
      parseSpecialBlocks({ textFrames: [tf] });
      expect(tf.name).toBe(`${prefix}settings`);
    }
  });

  it("gives all2html- precedence over ai2html- key-by-key, in either document order", () => {
    const legacy = () => frame("ai2html-settings\nimage_format: jpg\nproject_name: legacy");
    const current = () => frame("all2html-settings\nimage_format: png\noutput: one-file");

    for (const textFrames of [
      [legacy(), current()],
      [current(), legacy()],
    ]) {
      const result = parseSpecialBlocks({ textFrames });
      // Contested key: all2html- wins regardless of frame order.
      expect(result.settings.image_format).toBe("png");
      // Uncontested keys from both blocks survive.
      expect(result.settings.project_name).toBe("legacy");
      expect(result.settings.output).toBe("one-file");
    }
  });

  it("applies the same precedence to the -text block", () => {
    const result = parseSpecialBlocks({
      textFrames: [
        frame("all2html-text\nheadline: new"),
        frame("ai2html-text\nheadline: old\nsubhead: kept"),
      ],
    });
    expect(result.settings).toEqual({ headline: "new", subhead: "kept" });
  });

  it("collects custom blocks from both spellings in document order", () => {
    const result = parseSpecialBlocks({
      textFrames: [
        frame("ai2html-html-before\n<p>one</p>"),
        frame("all2html-html-before\n<p>two</p>"),
      ],
    });
    expect(result.customBlocks).toEqual([
      { type: "html-before", content: "<p>one</p>" },
      { type: "html-before", content: "<p>two</p>" },
    ]);
  });

  it("reports hidden and empty blocks under the name the user typed", () => {
    expect(() =>
      parseSpecialBlocks({ textFrames: [frame("all2html-settings\nfoo: bar", { hidden: true })] }),
    ).toThrow(/hidden all2html-settings text block/);
    expect(() =>
      parseSpecialBlocks({ textFrames: [frame("ai2html-settings\nfoo: bar", { hidden: true })] }),
    ).toThrow(/hidden ai2html-settings text block/);
  });
});
