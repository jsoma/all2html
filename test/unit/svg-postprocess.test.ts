import { describe, expect, it } from "vitest";
import { postprocessSVG } from "../../src/core/svg-postprocess.js";

describe("postprocessSVG", () => {
  it("removes XML processing instruction", () => {
    const input = '<?xml version="1.0" encoding="UTF-8"?>\n<svg><rect/></svg>';
    const result = postprocessSVG(input);
    expect(result).not.toContain("<?xml");
    expect(result).toContain("<svg>");
  });

  it("cleans Illustrator-generated IDs", () => {
    const input = '<svg><g id="Layer_1_"><rect id="rect_2_"/></g></svg>';
    const result = postprocessSVG(input);
    expect(result).toContain('id="Layer"');
    expect(result).toContain('id="rect"');
  });

  it("adds data-name attributes", () => {
    const input = '<svg><g id="Africa_1_"></g></svg>';
    const result = postprocessSVG(input);
    expect(result).toContain('data-name="Africa"');
  });

  it("handles duplicate IDs with suffix", () => {
    const input = '<svg><g id="text_1_"></g><g id="text_2_"></g></svg>';
    const result = postprocessSVG(input);
    expect(result).toContain('id="text"');
    expect(result).toContain('id="text-2"');
  });

  it("decodes hex character codes", () => {
    const input = '<svg><g id="New_x20_York"></g></svg>';
    const result = postprocessSVG(input);
    expect(result).toContain('data-name="New York"');
  });

  it("applies optional ID prefix", () => {
    const input = '<svg><g id="Layer_1_"></g></svg>';
    const result = postprocessSVG(input, { idPrefix: "ai-" });
    expect(result).toContain('id="ai-Layer"');
  });

  it("injects non-scaling-stroke CSS", () => {
    const input = "<svg><rect/></svg>";
    const result = postprocessSVG(input);
    expect(result).toContain("vector-effect:non-scaling-stroke");
    expect(result).toContain("<style>");
  });

  it("can skip non-scaling-stroke injection", () => {
    const input = "<svg><rect/></svg>";
    const result = postprocessSVG(input, { injectNonScalingStroke: false });
    expect(result).not.toContain("non-scaling-stroke");
  });

  it("removes embedded <image> elements", () => {
    const input = '<svg><image href="data:image/png;base64,abc"/><rect/></svg>';
    const result = postprocessSVG(input);
    expect(result).not.toContain("<image");
    expect(result).toContain("<rect");
  });

  it("restores opacity from encoded names", () => {
    const input = '<svg><g id="Z--opacity50--mygroup"></g></svg>';
    const result = postprocessSVG(input);
    expect(result).toContain("opacity:0.5");
    expect(result).toContain('id="mygroup"');
  });

  it("restores multiply blend mode from encoded names", () => {
    const input = '<svg><g id="Z--multiply--overlay"></g></svg>';
    const result = postprocessSVG(input);
    expect(result).toContain("mix-blend-mode:multiply");
    expect(result).toContain('id="overlay"');
  });

  it("restores both opacity and multiply", () => {
    const input = '<svg><g id="Z--opacity70--multiply--shadow"></g></svg>';
    const result = postprocessSVG(input);
    expect(result).toContain("opacity:0.7");
    expect(result).toContain("mix-blend-mode:multiply");
    expect(result).toContain('id="shadow"');
  });

  it("updates url() references when IDs change", () => {
    const input =
      '<svg><defs><clipPath id="clip_1_"><rect/></clipPath></defs><g clip-path="url(#clip_1_)"><rect/></g></svg>';
    const result = postprocessSVG(input);
    expect(result).toContain('id="clip"');
    expect(result).toContain("url(#clip)");
  });

  it("decodes 4-digit Unicode hex codes", () => {
    const input = '<svg><g id="em_x2014_dash"></g></svg>';
    const result = postprocessSVG(input);
    expect(result).toContain('data-name="em\u2014dash"');
  });

  it("handles empty cleaned IDs with fallback", () => {
    const input = '<svg><g id="__1_"></g></svg>';
    const result = postprocessSVG(input);
    // Should not produce an empty ID
    expect(result).toMatch(/id="[^"]+"/);
    expect(result).not.toContain('id=""');
  });

  it("handles case-insensitive </SVG> closing tag", () => {
    const input = "<svg><rect/></SVG>";
    const result = postprocessSVG(input);
    expect(result).toContain("non-scaling-stroke");
    expect(result).toContain("<style>");
  });

  it("handles url with single quotes", () => {
    const input =
      '<svg><defs><clipPath id="mask_1_"><rect/></clipPath></defs><g clip-path="url(\'#mask_1_\')"><rect/></g></svg>';
    const result = postprocessSVG(input);
    expect(result).toContain("url('#mask')");
  });

  it("updates cross-references to Z-encoded elements", () => {
    const input =
      '<svg><g id="Z--opacity50--shadow"><rect/></g><use href="#Z--opacity50--shadow"/></svg>';
    const result = postprocessSVG(input);
    // The Z-encoded ID should be restored to "shadow" and the reference updated
    expect(result).toContain('id="shadow"');
    expect(result).toContain("opacity:0.5");
    expect(result).toContain('href="#shadow"');
    expect(result).not.toContain("Z--");
  });
});
