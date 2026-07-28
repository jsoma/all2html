import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitSvelte } from "../../src/emitters/svelte.js";
import type { SvelteEmitterOptions } from "../../src/emitters/types.js";
import {
  COMPONENT_DEFAULT_OPTIONS,
  COMPONENT_EMITTER_OPTIONS,
  COMPONENT_FIXTURES,
  COMPONENT_STRUCTURAL_FIXTURES,
} from "../fixtures/component-fixtures.js";

function compileFixture(fixtureName: string, options?: SvelteEmitterOptions) {
  const ir = JSON.parse(readFileSync(`test/fixtures/ir/${fixtureName}`, "utf-8"));
  const { document: doc } = processDocument(ir);
  const { svelte, structuredWarnings } = emitSvelte(doc, undefined, options);
  const compiled = compile(svelte, { name: "Graphic", filename: "Graphic.svelte" });
  return { svelte, compiled, css: compiled.css?.code ?? "", structuredWarnings };
}

// The fixture list is shared with `react-emitter-compile.test.ts`. It used to be
// hand-picked here, and it omitted `escaping-adversarial.json` — which the
// Svelte emitter had been failing to compile in every option set.
function expectCompiles(fixture: string, options: SvelteEmitterOptions | undefined) {
  const { compiled } = compileFixture(fixture, options);
  // A pruned stylesheet is as broken as a failed compile — see below.
  expect(compiled.warnings.filter((w) => w.code === "css_unused_selector")).toEqual([]);
}

describe("every fixture compiles as a Svelte component", () => {
  it("sweeps structural fixtures that all exist in the corpus", () => {
    for (const fixture of COMPONENT_STRUCTURAL_FIXTURES) {
      expect(COMPONENT_FIXTURES, fixture).toContain(fixture);
    }
  });

  // The fixture axis stays whole: the `css_global_block_invalid_declaration`
  // failure on `escaping-adversarial.json` was a fixture-axis bug, and it
  // reproduced under every option set.
  for (const fixture of COMPONENT_FIXTURES) {
    it(`compiles ${fixture} with ${COMPONENT_DEFAULT_OPTIONS.label}`, () => {
      expectCompiles(fixture, COMPONENT_DEFAULT_OPTIONS.options);
    });
  }

  // The option axis is swept only where it can change the emitted markup.
  for (const fixture of COMPONENT_STRUCTURAL_FIXTURES) {
    for (const { label, options } of COMPONENT_EMITTER_OPTIONS) {
      it(`compiles ${fixture} with ${label}`, () => {
        expectCompiles(fixture, options as SvelteEmitterOptions);
      });
    }
  }
});

describe("Svelte emitter compiles against the real Svelte compiler", () => {
  // Regression: markup is delivered via {@html}, which the compiler cannot see
  // into. Without a :global wrapper every selector is reported unused and the
  // whole stylesheet — including the @container breakpoint rules — is commented
  // out, leaving a non-responsive, unstyled component.
  it("emits no css_unused_selector warnings for a responsive fixture", () => {
    const { compiled } = compileFixture("multi-artboard-responsive.json");
    const unused = compiled.warnings.filter((w) => w.code === "css_unused_selector");
    expect(unused.map((w) => w.message)).toEqual([]);
  });

  it("keeps the container and artboard rules in the compiled CSS", () => {
    const { css } = compileFixture("multi-artboard-responsive.json");
    expect(css).not.toMatch(/\/\* \(unused\)/);
    expect(css).toMatch(/#g-responsive-test-box\s*\{[^}]*container-type:\s*inline-size/);
    expect(css).toContain("@container");
    expect(css).toContain("#g-responsive-test-mobile");
    expect(css).toContain("#g-responsive-test-tablet");
  });

  it("wraps the emitted stylesheet in a :global block", () => {
    const { svelte } = compileFixture("multi-artboard-responsive.json");
    expect(svelte).toContain("<style>\n:global {");
  });

  it("compiles a non-responsive fixture without css warnings", () => {
    const { compiled, css } = compileFixture("single-artboard-basic.json");
    expect(compiled.warnings.filter((w) => w.code === "css_unused_selector")).toEqual([]);
    expect(css).not.toMatch(/\/\* \(unused\)/);
    expect(css.trim()).not.toBe("");
  });

  // Every fixture below reaches the compiler through markup that is now partly
  // real Svelte elements rather than one opaque {@html} string, so a malformed
  // spine is a compile error rather than a silently broken component.
  it("compiles a fixture whose snippets became real snippet props", () => {
    const { svelte, compiled } = compileFixture("snippet-layer.json");

    expect(svelte).toContain("{@render chart?.()}");
    expect(svelte).toContain("{@render footer?.()}");
    expect(svelte).toMatch(/let \{[^}]*\bchart\b[^}]*\bfooter\b[^}]*\} = \$props\(\)/);
    expect(compiled.warnings.filter((w) => w.code === "css_unused_selector")).toEqual([]);
  });

  it("compiles a fixture whose bound text became a bindings prop", () => {
    const { svelte, compiled } = compileFixture("tagged-text.json");

    // Plain binding: text interpolation. allowHtml binding: {@html}.
    expect(svelte).toContain('{#if bindings["headlines.main"] != null}');
    expect(svelte).toContain('{bindings["headlines.main"]}');
    expect(svelte).toContain('{@html bindings["content.body"]}');
    // The design-file text stays as the fallback branch.
    expect(svelte).toContain("Default Headline");
    expect(compiled.warnings.filter((w) => w.code === "css_unused_selector")).toEqual([]);
  });

  it("compiles with comments left in the markup", () => {
    // Regression: both framework emitters used to run /<!--[\s\S]*?-->/g over the
    // serialized HTML, which removed the generator comments AND any comment an
    // author had written inside an html-before / html-after block.
    const ir = JSON.parse(readFileSync("test/fixtures/ir/single-artboard-basic.json", "utf-8"));
    const { document: doc } = processDocument(ir);
    doc.customBlocks.push({
      type: "html-before",
      content: '<!-- desk note: do not remove --><div class="note">note</div>',
    });

    const { svelte } = emitSvelte(doc);
    expect(svelte).toContain("<!-- desk note: do not remove -->");
    expect(svelte).toContain("<!-- Generated by all2html -->");

    const compiled = compile(svelte, { name: "Graphic", filename: "Graphic.svelte" });
    expect(compiled.warnings.filter((w) => w.code === "css_unused_selector")).toEqual([]);
  });
});
