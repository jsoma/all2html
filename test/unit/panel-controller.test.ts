import { describe, expect, it } from "vitest";

import { resolveResultOutputPath } from "../../plugins/illustrator/panel/src/js/panel-controller.js";

describe("resolveResultOutputPath", () => {
  it("prefers the explicit exporter output path", () => {
    expect(resolveResultOutputPath("/tmp/export/", "/Users/test/doc", "all2html-output/")).toBe(
      "/tmp/export/",
    );
  });

  it("falls back to the document folder plus configured output path", () => {
    expect(resolveResultOutputPath("", "/Users/test/project", "all2html-output/")).toBe(
      "/Users/test/project/all2html-output/",
    );
  });

  it("preserves absolute configured fallback paths", () => {
    expect(resolveResultOutputPath(undefined, "/Users/test/project", "/tmp/all2html-output/")).toBe(
      "/tmp/all2html-output/",
    );
  });

  it("uses windows separators when the document path uses them", () => {
    expect(resolveResultOutputPath(undefined, "C:\\Work\\Project", "all2html-output\\")).toBe(
      "C:\\Work\\Project\\all2html-output\\",
    );
  });

  it("returns null when it cannot resolve any output folder", () => {
    expect(resolveResultOutputPath(undefined, "", "")).toBeNull();
  });
});
