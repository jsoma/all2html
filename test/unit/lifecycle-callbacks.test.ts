import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import {
  extractBreakpointData,
  findActiveBreakpoint,
  isBreakpointActive,
} from "../../src/emitters/shared/breakpoint-data.js";

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

    it("leaves the widest artboard's maxWidth absent, not capped", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const entries = extractBreakpointData(doc);

      const largest = entries[entries.length - 1];
      // Absence, not a sentinel. This used to be `99999`, which is a real upper
      // bound to any consumer doing `minWidth <= w <= maxWidth` — the same defect
      // that removing `Infinity` from the document model was meant to fix, just
      // relocated to the consumer.
      expect(largest.maxWidth).toBeUndefined();
      expect("maxWidth" in largest).toBe(false);
    });

    it("treats an absent maxWidth as unbounded above", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const entries = extractBreakpointData(doc);
      const largest = entries[entries.length - 1];

      // The widths that a 99999 sentinel silently dropped on the floor.
      for (const width of [largest.minWidth, 99999, 100000, 120000, 1e9]) {
        expect(isBreakpointActive(largest, width)).toBe(true);
        expect(findActiveBreakpoint(entries, width)).toBe(largest);
      }
      expect(isBreakpointActive(largest, largest.minWidth - 1)).toBe(false);
    });

    it("finds exactly one active entry at every width", () => {
      const { document: doc } = loadAndProcess("multi-artboard-responsive.json");
      const entries = extractBreakpointData(doc);

      for (const width of [0, 1, 767, 768, 1199, 1200, 5000, 120000]) {
        const active = entries.filter((e) => isBreakpointActive(e, width));
        expect(active).toHaveLength(1);
      }
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
