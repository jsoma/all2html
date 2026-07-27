// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getSelectedTopLevelFrames } from "../../plugins/figma/src/extract/frames.js";
import type { SandboxToUiMessage, SelectionSummary } from "../../plugins/figma/src/types.js";
import { createEmptySelectionSummary } from "../../plugins/figma/src/ui.js";

/**
 * `ui-entry.ts` carried its own `escapeHtml` that escaped `&`, `<`, `>`, `"`
 * and `'`. It now imports the shared one, which is deliberately narrowed to
 * hast's text-node subset (`&` and `<` only) so the emitters and the hast
 * adapter stay byte-identical. Narrowing is only safe because every call site
 * in this file is *text content*, where a bare `>` or `"` cannot start a tag.
 * This test proves that claim on the one string a user actually controls: the
 * selection error, which embeds Figma layer names verbatim.
 */
const uiHtmlPath = resolve(import.meta.dirname, "../../plugins/figma/src/ui.html");

let onMessage: (event: { data: { pluginMessage: SandboxToUiMessage } }) => void;

function mountUi(): void {
  const template = readFileSync(uiHtmlPath, "utf-8");
  const body = template.slice(template.indexOf("<body>") + "<body>".length);
  document.body.innerHTML = body.slice(0, body.indexOf("<script>"));
}

beforeAll(async () => {
  mountUi();
  // The module bootstraps itself on import, so the DOM has to exist first.
  await import("../../plugins/figma/src/ui-entry.js");
  const handler = window.onmessage;
  if (!handler) throw new Error("ui-entry did not install a message handler.");
  onMessage = handler as unknown as typeof onMessage;
});

function publishSelection(selection: SelectionSummary): void {
  onMessage({ data: { pluginMessage: { type: "selection-summary", selection } } });
}

describe("Figma plugin UI escaping", () => {
  it("renders a hostile layer name in a selection error as text, not markup", () => {
    // The real message shape: `getSelectedTopLevelFrames` interpolates the node
    // name straight into its error.
    const hostileName = `<img src=x onerror="alert(1)"> & "quoted" 'single' \`tick\``;
    let error = "";
    try {
      getSelectedTopLevelFrames([
        { id: "1", name: hostileName, type: "GROUP", parent: { type: "PAGE" } },
      ]);
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
    }
    expect(error).toContain(hostileName);

    publishSelection({ ...createEmptySelectionSummary(), totalSelected: 1, error });

    const validation = document.querySelector("[data-validation]");
    if (!validation) throw new Error("Missing [data-validation].");

    // Byte-for-byte round trip through the parser: nothing was consumed as
    // markup, and every character the narrowed escaper leaves alone is inert
    // in a text position.
    expect(validation.textContent).toBe(error);
    expect(validation.querySelector("img")).toBeNull();
    expect(validation.querySelectorAll("p")).toHaveLength(1);
    expect(validation.querySelector("p")?.className).toBe("validation-error");
  });

  it("keeps the summary paragraph's own class attribute intact", () => {
    publishSelection({
      ...createEmptySelectionSummary(),
      totalSelected: 1,
      error: `" onclick="alert(1)`,
    });

    const summary = document.querySelector("[data-selection] p");
    if (!summary) throw new Error("Missing selection summary paragraph.");
    // The class is a literal in the template, not user text — the user string
    // lands in the element's text, and must not be able to reach the attribute.
    expect(summary.className).toBe("validation-error");
    expect(summary.hasAttribute("onclick")).toBe(false);
  });
});
