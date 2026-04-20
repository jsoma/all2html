import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { extractBreakpointData } from "../../src/emitters/shared/breakpoint-data.js";

function loadAndProcess(fixtureName: string) {
  const ir = JSON.parse(readFileSync(`test/fixtures/ir/${fixtureName}`, "utf-8"));
  return processDocument(ir);
}

describe("lifecycle callbacks", () => {
  describe("extractBreakpointData", () => {
    it("extracts breakpoint entries sorted by minWidth", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const entries = extractBreakpointData(doc);

      expect(entries).toHaveLength(3);
      expect(entries[0].artboardName).toBe("mobile");
      expect(entries[0].minWidth).toBe(0);
      expect(entries[1].artboardName).toBe("tablet");
      expect(entries[1].minWidth).toBe(768);
      expect(entries[2].artboardName).toBe("desktop");
      expect(entries[2].minWidth).toBe(1200);
    });

    it("generates correct artboard IDs", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const entries = extractBreakpointData(doc);

      expect(entries[0].artboardId).toBe("g-responsive-test-mobile");
      expect(entries[1].artboardId).toBe("g-responsive-test-tablet");
      expect(entries[2].artboardId).toBe("g-responsive-test-desktop");
    });

    it("caps Infinity maxWidth to 99999", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const entries = extractBreakpointData(doc);

      // The largest artboard should have maxWidth capped
      const largest = entries[entries.length - 1];
      expect(largest.maxWidth).toBe(99999);
    });

    it("returns single entry for single-artboard documents", () => {
      const { document: doc } = loadAndProcess("single-artboard-basic.json");
      const entries = extractBreakpointData(doc);
      expect(entries).toHaveLength(1);
      expect(entries[0].minWidth).toBe(0);
    });

    it("breakpoint values match CSS container query boundaries", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const entries = extractBreakpointData(doc);

      // Adjacent breakpoints should not overlap
      for (let i = 0; i < entries.length - 1; i++) {
        expect(entries[i].maxWidth).toBeLessThan(entries[i + 1].minWidth);
      }
    });
  });
});
