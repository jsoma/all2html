/**
 * The After Effects exporter's status contract (spec §5.5):
 *
 *  - explicit comp targeting: a supplied targetCompId is honored or the run
 *    fails naming it — never a silent fall-through to the active comp;
 *  - one status, checked against the filesystem: `complete` only when the
 *    expected video file exists after render(), `queued` for an AME
 *    submission (with the expected path), `failed` otherwise;
 *  - poster disposition: an auto-detected poster that fails is a warning; a
 *    poster the caller explicitly requested that fails fails the run.
 *
 * These run the whole shipped exporter.jsx through the fake AE DOM, so every
 * assertion is against the orchestration in `exportActiveComp()`.
 */
import { describe, expect, it } from "vitest";
import { runAfterEffectsExporter, writtenSummary } from "../helpers/after-effects-fake-dom.js";

const LOCAL_TEMPLATES = ["H.264", "PNG Sequence"];

describe("comp targeting", () => {
  it("fails a stale targetCompId with an error naming the id, exporting nothing", () => {
    const result = runAfterEffectsExporter({
      comps: [{ id: "1", name: "Main Comp" }],
      activeCompId: "1",
      outputTemplates: LOCAL_TEMPLATES,
      panelSettings: { targetCompId: "999" },
    });

    expect(result.threw).toBe(true);
    expect(result.envelope.status).toBe("failed");
    expect(result.envelope.error).toContain('"999"');
    // The active comp must NOT have been exported in its place.
    expect(result.files.size).toBe(0);
    expect(result.renderCalls).toBe(0);
  });

  it("exports the supplied targetCompId even when a different comp is active", () => {
    const result = runAfterEffectsExporter({
      comps: [
        { id: "1", name: "Wrong Comp" },
        { id: "2", name: "Target Comp" },
      ],
      activeCompId: "1",
      outputTemplates: LOCAL_TEMPLATES,
      panelSettings: { targetCompId: "2" },
    });

    expect(result.envelope.status).toBe("complete");
    expect(result.envelope.compName).toBe("Target Comp");
    expect(result.envelope.slug).toBe("target-comp");
  });

  it("uses the active comp when no targetCompId is supplied", () => {
    const result = runAfterEffectsExporter({
      comps: [{ id: "1", name: "Main Comp" }],
      activeCompId: "1",
      outputTemplates: LOCAL_TEMPLATES,
    });

    expect(result.envelope.status).toBe("complete");
    expect(result.envelope.compName).toBe("Main Comp");
  });

  it("fails when no targetCompId is supplied and no comp is active", () => {
    const result = runAfterEffectsExporter({
      comps: [{ id: "1", name: "Main Comp" }],
      activeCompId: null,
      outputTemplates: LOCAL_TEMPLATES,
    });

    expect(result.threw).toBe(true);
    expect(result.envelope.status).toBe("failed");
    expect(result.envelope.error).toContain("composition active");
  });
});

describe("export status against the filesystem", () => {
  it("is complete only when the expected video file exists after render()", () => {
    const result = runAfterEffectsExporter({
      comps: [{ id: "1", name: "Main Comp" }],
      outputTemplates: LOCAL_TEMPLATES,
      renderWritesVideo: true,
    });

    expect(result.envelope.status).toBe("complete");
    expect(result.envelope.video?.mode).toBe("render-queue");
    expect(result.envelope.video?.error).toBeNull();
    const videoPath = result.envelope.video?.path;
    expect(videoPath).toBe("/proj/all2html-ae-output/main-comp/main-comp.mp4");
    expect(result.files.has(videoPath as string)).toBe(true);
    expect(writtenSummary(result)?.status).toBe("complete");
  });

  it("is failed when render() ran but the expected video file is missing", () => {
    const result = runAfterEffectsExporter({
      comps: [{ id: "1", name: "Main Comp" }],
      outputTemplates: LOCAL_TEMPLATES,
      renderWritesVideo: false,
    });

    expect(result.threw).toBe(false);
    expect(result.envelope.status).toBe("failed");
    expect(result.envelope.video?.error).toContain(
      "/proj/all2html-ae-output/main-comp/main-comp.mp4",
    );
    expect(result.envelope.error).toContain("main-comp.mp4");
    expect(writtenSummary(result)?.status).toBe("failed");
  });

  it("is queued (not failed, not complete) for an AME submission, with the expected path", () => {
    const result = runAfterEffectsExporter({
      comps: [{ id: "1", name: "Main Comp" }],
      outputTemplates: [],
      canQueueInAME: true,
    });

    expect(result.envelope.status).toBe("queued");
    expect(result.envelope.video?.mode).toBe("ame");
    expect(result.envelope.video?.path).toBe("/proj/all2html-ae-output/main-comp/main-comp.mp4");
    expect(result.envelope.video?.error).toBeNull();
    expect(result.ameQueueCalls).toBe(1);
    expect(writtenSummary(result)?.status).toBe("queued");
  });

  it("carries no legacy success/rendered booleans — status is the one truth", () => {
    const result = runAfterEffectsExporter({
      comps: [{ id: "1", name: "Main Comp" }],
      outputTemplates: LOCAL_TEMPLATES,
    });

    const envelope = result.envelope as Record<string, unknown>;
    expect(envelope.success).toBeUndefined();
    expect(envelope.videoRendered).toBeUndefined();
    expect(envelope.posterRendered).toBeUndefined();
    const summary = writtenSummary(result) as Record<string, unknown>;
    expect(summary.success).toBeUndefined();
    expect((summary.video as Record<string, unknown>).rendered).toBeUndefined();
    expect((summary.poster as Record<string, unknown>).rendered).toBeUndefined();
  });
});

describe("poster disposition", () => {
  it("warns (status stays complete) when the auto-detected poster fails", () => {
    const result = runAfterEffectsExporter({
      comps: [{ id: "1", name: "Main Comp" }],
      // Video template available, no poster-capable template.
      outputTemplates: ["H.264"],
    });

    expect(result.envelope.status).toBe("complete");
    expect(result.envelope.poster?.requested).toBe(false);
    expect(result.envelope.poster?.error).toContain("poster output-module template");
    expect(result.envelope.warnings?.length).toBe(1);
    expect(result.envelope.warnings?.[0]).toContain("Poster skipped");
  });

  it("warns when the poster template resolved but wrote no file", () => {
    const result = runAfterEffectsExporter({
      comps: [{ id: "1", name: "Main Comp" }],
      outputTemplates: LOCAL_TEMPLATES,
      renderWritesPoster: false,
    });

    expect(result.envelope.status).toBe("complete");
    expect(result.envelope.warnings?.length).toBe(1);
    expect(result.envelope.poster?.error).toContain("no poster file was written");
  });

  it("fails the run when an explicitly requested poster template fails", () => {
    const result = runAfterEffectsExporter({
      comps: [{ id: "1", name: "Main Comp" }],
      outputTemplates: ["H.264"],
      panelSettings: { posterTemplate: "PNG Sequence" },
    });

    expect(result.envelope.status).toBe("failed");
    expect(result.envelope.poster?.requested).toBe(true);
    expect(result.envelope.poster?.error).toContain("PNG Sequence");
    expect(result.envelope.error).toContain("PNG Sequence");
    // The video itself succeeded; the failure is attributed to the poster.
    expect(result.envelope.video?.error).toBeNull();
    expect(result.envelope.warnings).toEqual([]);
  });

  it("keeps queued + warning when AME is used and the auto poster fails", () => {
    const result = runAfterEffectsExporter({
      comps: [{ id: "1", name: "Main Comp" }],
      outputTemplates: [],
      canQueueInAME: true,
    });

    expect(result.envelope.status).toBe("queued");
    expect(result.envelope.warnings?.length).toBe(1);
  });
});
