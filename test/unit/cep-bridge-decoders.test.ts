/**
 * evalTS returns `unknown` (spec §5.6): the host is untyped ExtendScript, so
 * the bridge wrappers whose results feed logic — runExport, getDocumentInfo,
 * the AE project/comps/templates lists, runAeExport — field-check what they
 * receive and reject malformed payloads instead of casting them through.
 * Mutation wrappers throw on the host's `{success: false}` shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../plugins/illustrator/panel/src/js/lib/utils/bolt.js", () => ({
  evalTS: vi.fn(),
}));

import {
  getAeMissingFonts,
  getAeOutputTemplates,
  getAeProjectInfo,
  listAeComps,
  runAeExport,
  saveAeConfigFile,
} from "../../plugins/illustrator/panel/src/js/ae-bridge.js";
import {
  getDocumentInfo,
  runExport,
  saveXmpSettings,
} from "../../plugins/illustrator/panel/src/js/bridge.js";
import { evalTS } from "../../plugins/illustrator/panel/src/js/lib/utils/bolt.js";

const evalTSMock = vi.mocked(evalTS);

beforeEach(() => {
  evalTSMock.mockReset();
});

describe("Illustrator bridge decoders", () => {
  it("passes a well-formed document info through", async () => {
    evalTSMock.mockResolvedValue({
      name: "chart.ai",
      path: "/docs",
      saved: true,
      artboardCount: 2,
      settingsBlockSignature: "5:abc",
    });

    await expect(getDocumentInfo()).resolves.toEqual({
      name: "chart.ai",
      path: "/docs",
      saved: true,
      artboardCount: 2,
      settingsBlockSignature: "5:abc",
    });
  });

  it("returns null for the host's no-document answer", async () => {
    evalTSMock.mockResolvedValue("null");
    await expect(getDocumentInfo()).resolves.toBeNull();
  });

  it("rejects a malformed document info instead of casting it through", async () => {
    evalTSMock.mockResolvedValue({ name: 42, saved: "yes" });
    await expect(getDocumentInfo()).rejects.toThrow(/Malformed document info/);
  });

  it("rejects a malformed export result", async () => {
    evalTSMock.mockResolvedValue("Error 21: undefined is not an object");
    await expect(runExport("{}", "[]")).rejects.toThrow(/Malformed export result/);
  });

  it("passes a well-formed export result through", async () => {
    evalTSMock.mockResolvedValue({ success: true, slug: "chart" });
    await expect(runExport("{}", "[]")).resolves.toMatchObject({ success: true, slug: "chart" });
  });

  it("throws when a mutation reports {success: false}", async () => {
    evalTSMock.mockResolvedValue({ success: false, error: "XMP write failed" });
    await expect(saveXmpSettings("{}")).rejects.toThrow("XMP write failed");
  });
});

describe("After Effects bridge decoders", () => {
  it("decodes the project info and rejects malformed payloads", async () => {
    evalTSMock.mockResolvedValue({ name: "p.aep", path: "/proj", saved: true, compCount: 1 });
    await expect(getAeProjectInfo()).resolves.toMatchObject({ name: "p.aep", compCount: 1 });

    evalTSMock.mockResolvedValue({ name: "p.aep" });
    await expect(getAeProjectInfo()).rejects.toThrow(/Malformed project info/);
  });

  it("decodes the comps list and rejects malformed entries instead of dropping them", async () => {
    evalTSMock.mockResolvedValue([
      { id: "1", name: "Main", width: 600, height: 400, duration: 2, frameRate: 30 },
    ]);
    await expect(listAeComps()).resolves.toEqual([
      { id: "1", name: "Main", width: 600, height: 400, duration: 2, frameRate: 30 },
    ]);

    // A silently shortened list looks like the comp was deleted — a malformed
    // entry is a broken host contract and must throw.
    evalTSMock.mockResolvedValue([
      { id: "1", name: "Main", width: 600, height: 400, duration: 2, frameRate: 30 },
      { id: 2, name: "Broken" },
    ]);
    await expect(listAeComps()).rejects.toThrow(/Malformed comp entry/);

    evalTSMock.mockResolvedValue({ nope: true });
    await expect(listAeComps()).rejects.toThrow(/Malformed comps list/);
  });

  it("rejects a template catalog whose fields have the wrong shape", async () => {
    evalTSMock.mockResolvedValue({ outputModuleTemplates: 42, canQueueInAME: "true" });
    await expect(getAeOutputTemplates("1")).rejects.toThrow(/Malformed template catalog/);

    evalTSMock.mockResolvedValue({ outputModuleTemplates: ["H.264"], canQueueInAME: "true" });
    await expect(getAeOutputTemplates("1")).rejects.toThrow(/Malformed template catalog/);
  });

  it("surfaces a stale-comp template catalog as a thrown error, not an empty list", async () => {
    evalTSMock.mockResolvedValue({
      outputModuleTemplates: [],
      canQueueInAME: false,
      error: 'The selected composition (id "42") was not found in this project.',
    });

    await expect(getAeOutputTemplates("42")).rejects.toThrow('id "42"');
  });

  it("decodes a normal template catalog", async () => {
    evalTSMock.mockResolvedValue({
      outputModuleTemplates: ["H.264", ""],
      canQueueInAME: true,
    });

    await expect(getAeOutputTemplates("1")).resolves.toEqual({
      outputModuleTemplates: ["H.264"],
      canQueueInAME: true,
    });
  });

  it("surfaces a stale-comp missing-fonts answer as a thrown error, not an empty list", async () => {
    evalTSMock.mockResolvedValue({
      error: 'The selected composition (id "42") was not found in this project.',
    });

    await expect(getAeMissingFonts([], "42")).rejects.toThrow('id "42"');
  });

  it("passes the AE status result through and strips any synthesized success boolean", async () => {
    evalTSMock.mockResolvedValue({
      status: "queued",
      success: true,
      video: { mode: "ame", path: "/out/x.mp4", error: null },
      warnings: ["Poster skipped: no template", 42],
    });

    const result = await runAeExport("{}", "[]");
    expect(result.status).toBe("queued");
    expect((result as unknown as Record<string, unknown>).success).toBeUndefined();
    expect(result.video?.mode).toBe("ame");
    // Non-string warning entries are dropped, not stringified.
    expect(result.warnings).toEqual(["Poster skipped: no template"]);
  });

  it("maps the shared export runner's {success:false} failures to status failed", async () => {
    evalTSMock.mockResolvedValue({
      success: false,
      error: "Cannot find all2html-ae.jsx. Expected at: /x",
      diagnostics: { entries: [] },
    });

    await expect(runAeExport("{}", "[]")).resolves.toEqual({
      status: "failed",
      error: "Cannot find all2html-ae.jsx. Expected at: /x",
      diagnostics: { entries: [] },
    });
  });

  it("rejects an AE export result with neither status nor success", async () => {
    evalTSMock.mockResolvedValue({ done: true });
    await expect(runAeExport("{}", "[]")).rejects.toThrow(/missing status/);
  });

  it("throws when saving the AE config file reports {success: false}", async () => {
    evalTSMock.mockResolvedValue({
      success: false,
      error: "Save the After Effects project first.",
    });
    await expect(saveAeConfigFile("{}")).rejects.toThrow("Save the After Effects project first.");
  });
});
