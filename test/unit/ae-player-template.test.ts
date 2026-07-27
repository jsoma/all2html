import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = resolve(import.meta.dirname, "../..");
const pluginTemplatePath = resolve(rootDir, "plugins/after-effects/player-template.html");

function readTemplate(path: string): string {
  return readFileSync(path, "utf8");
}

function assertScopedEmbedContract(template: string): void {
  expect(template).not.toMatch(/<!doctype html>/i);
  expect(template).not.toMatch(/<html[\s>]/i);
  expect(template).not.toMatch(/<head[\s>]/i);
  expect(template).not.toMatch(/<body[\s>]/i);

  expect(template).toContain("data-all2html-ae");
  expect(template).toContain("__GOOGLE_FONT_LINKS__");
  expect(template).toContain("__GOOGLE_FONT_IMPORT__");
  expect(template).toContain('data-ae-role="video"');
  expect(template).toContain('data-ae-role="model"');

  expect(template).not.toContain('id="video"');
  expect(template).not.toContain('getElementById("video")');
  expect(template).not.toContain('data-ae-role="meta"');
  expect(template).not.toContain("all2html-ae__header");
  expect(template).not.toContain("all2html-ae__footer");
  expect(template).toContain("root.all2htmlAE");
}

describe("after effects player template", () => {
  it("ships as a self-scoped embed fragment in the plugin template", () => {
    assertScopedEmbedContract(readTemplate(pluginTemplatePath));
  });

  // Removed: "keeps the prototype template aligned with the plugin template
  // contract". `temp/ae-prototype/player-template.html` was a byte-identical
  // copy of the file above, so the assertion could never fail independently.
  // The prototype is untracked; `plugins/after-effects/` replaces it.
});
