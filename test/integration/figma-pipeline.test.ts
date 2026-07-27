import { describe, expect, it } from "vitest";
import { makeFigmaArtboardId } from "../../plugins/figma/src/ir-ids.js";
import { exportExtractedFrames, summarizeSelection } from "../../plugins/figma/src/main.js";
import type { ExtractedFrame, SelectionNodeLike } from "../../plugins/figma/src/types.js";
import { processDocument } from "../../src/core/pipeline.js";
import { getEmitter } from "../../src/emitters/registry.js";
import { loadAndValidateIR } from "../../src/ir/validate.js";

function makeFrame(overrides: Partial<ExtractedFrame> = {}): ExtractedFrame {
  const sourceNodeId = overrides.sourceNodeId ?? "frame-1";
  const originalName = overrides.originalName ?? "story:640:dynamic";
  return {
    sourceNodeId,
    name: "story",
    originalName,
    width: 640,
    height: 360,
    actualWidth: 640,
    actualHeight: 360,
    responsiveness: "dynamic",
    layers: [
      {
        sourceNodeId: "layer-1",
        name: "content",
        type: "default",
        inlineSvg: false,
        visible: true,
        opacity: 100,
        elements: [
          {
            type: "text",
            id: "headline",
            kind: "point",
            position: { x: 20, y: 20, width: 300, height: 30 },
            opacity: 100,
            valign: "top",
            renderAs: "html",
            paragraphs: [
              {
                text: "Figma pipeline test",
                alignment: "left",
                leading: 28,
                spaceBefore: 0,
                spaceAfter: 0,
                runs: [
                  {
                    text: "Figma pipeline test",
                    fontName: "Inter-Regular",
                    fontPostScriptName: "Inter-Regular",
                    fontSize: 22,
                    color: { r: 0, g: 0, b: 0 },
                    letterSpacing: 0.01,
                    capitalization: "normal",
                    baselineShift: "normal",
                    hyperlink: { href: "https://example.com", target: "_blank" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    assets: [
      {
        id: `asset-${sourceNodeId}`,
        path: `${sourceNodeId}.png`,
        mimeType: "image/png",
        width: overrides.width ?? 640,
        height: 360,
        artboardId: makeFigmaArtboardId({ sourceNodeId, originalName }),
        exportParams: { format: "png24", scale: 1, transparent: true },
        bytes: new TextEncoder().encode("png"),
      },
    ],
    ...overrides,
  };
}

describe("Figma canonical plugin pipeline", () => {
  it("exports mock Figma frames through validation, processing, and HTML emission", () => {
    const result = exportExtractedFrames(
      [
        makeFrame(),
        makeFrame({
          sourceNodeId: "frame-2",
          originalName: "story:1024:dynamic",
          width: 1024,
          actualWidth: 1024,
          assets: [
            {
              id: "asset-frame-2",
              path: "frame-2.png",
              mimeType: "image/png",
              width: 1024,
              height: 360,
              artboardId: makeFigmaArtboardId({
                sourceNodeId: "frame-2",
                originalName: "story:1024:dynamic",
              }),
              exportParams: { format: "png24", scale: 1, transparent: true },
              bytes: new TextEncoder().encode("png"),
            },
          ],
        }),
      ],
      {
        slug: "figma-story",
        configText: `{
          "settings": { "output": "multiple-files", "projectName": "figma-story" },
          "metadata": { "headline": "Figma Story" }
        }`,
        format: "html",
        pluginVersion: "0.2.0",
      },
    );

    const doc = loadAndValidateIR(result.ir);
    expect(doc.source.tool).toBe("figma");
    expect(doc.metadata.headline).toBe("Figma Story");

    const { document, groups } = processDocument(result.ir);
    expect(groups).toHaveLength(1);
    expect(groups[0].artboards).toHaveLength(2);

    const htmlResult = getEmitter("html").emitAll(document, groups);
    expect(htmlResult.files).toHaveLength(1);
    expect(htmlResult.files[0].output).toContain("Figma pipeline test");
    expect(htmlResult.files[0].output).toContain("https://example.com");
    expect(htmlResult.files[0].output).toContain("all2html-output/frame-1.png");
    expect(htmlResult.files[0].output).toContain("all2html-output/frame-2.png");
    expect(result.zip.byteLength).toBeGreaterThan(0);
  });

  it("summarizes selected top-level frames for a thin UI", () => {
    const selection: SelectionNodeLike[] = [
      {
        id: "1",
        type: "FRAME",
        name: "story:640",
        width: 640,
        height: 360,
        parent: { type: "PAGE" },
      },
      {
        id: "2",
        type: "FRAME",
        name: "story:1024",
        width: 1024,
        height: 360,
        parent: { type: "PAGE" },
      },
    ];

    expect(summarizeSelection(selection)).toEqual({
      totalSelected: 2,
      eligibleFrames: 2,
      frameNames: ["story:640", "story:1024"],
      groupNames: ["story"],
      groups: [
        {
          name: "story",
          frameCount: 2,
          frameNames: ["story:640", "story:1024"],
          widths: [640, 1024],
          mode: "responsive",
        },
      ],
      exportKind: "responsive",
    });
  });
});
