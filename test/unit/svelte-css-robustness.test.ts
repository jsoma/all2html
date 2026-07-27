import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitReact } from "../../src/emitters/react.js";
import { toRuleList } from "../../src/emitters/shared/css-rule-list.js";
import { emitSvelte } from "../../src/emitters/svelte.js";
import type { EmitterReadyDocument } from "../../src/ir/types.js";

/**
 * Author CSS reaches the stylesheet verbatim, and the Svelte emitter wraps the
 * stylesheet in `:global { … }`, which accepts rules only. A stray `}`, an
 * unclosed rule, or a bare declaration in a custom `css` block was therefore a
 * **build failure** — and the compiler error pointed at the generated
 * `Graphic.svelte`, not at the CSS the author wrote. `escaping-adversarial.json`
 * hit it in all four option sets.
 */

function withCss(content: string): EmitterReadyDocument {
  const ir = JSON.parse(readFileSync("test/fixtures/ir/single-artboard-basic.json", "utf-8"));
  const { document: doc } = processDocument(ir);
  doc.customBlocks.push({ type: "css", content });
  return doc;
}

function emitAndCompile(doc: EmitterReadyDocument) {
  const result = emitSvelte(doc);
  const compiled = compile(result.svelte, { name: "Graphic", filename: "Graphic.svelte" });
  return { ...result, compiled, css: compiled.css?.code ?? "" };
}

describe("the Svelte emitter survives author CSS that is not a rule list", () => {
  const cases: Array<{ label: string; css: string; keeps: string }> = [
    {
      label: "a declaration outside any rule",
      css: "color: red;\n.kept { color: blue; }",
      keeps: ".kept",
    },
    { label: "a stray closing brace", css: ".kept { color: blue; }\n}", keeps: ".kept" },
    { label: "an unclosed rule", css: ".kept { color: blue;", keeps: ".kept" },
    {
      label: "markup pasted into the block",
      css: '.kept { color: blue; }\n</style><img src=x onerror="alert(1)">',
      keeps: ".kept",
    },
  ];

  for (const { label, css, keeps } of cases) {
    it(`compiles with ${label}`, () => {
      const { compiled, css: compiledCss } = emitAndCompile(withCss(css));
      expect(compiled.warnings.filter((w) => w.code === "css_unused_selector")).toEqual([]);
      // The well-formed part of the author's CSS is still there.
      expect(compiledCss).toContain(keeps);
    });

    it(`warns, naming the custom block, for ${label}`, () => {
      const { structuredWarnings } = emitAndCompile(withCss(css));
      const warning = structuredWarnings.find((w) => w.code === "emit:css-not-rule-list");
      expect(warning?.message).toContain("Custom CSS block 1 of 1");
      expect(warning?.category).toBe("markup");
    });
  }

  it("names the offending block when several are present", () => {
    const doc = withCss(".fine { color: blue; }");
    doc.customBlocks.push({ type: "css", content: "color: red;" });
    const { structuredWarnings } = emitAndCompile(doc);
    const messages = structuredWarnings
      .filter((w) => w.code === "emit:css-not-rule-list")
      .map((w) => w.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Custom CSS block 2 of 2");
    expect(messages[0]).toContain("color: red;");
  });

  it("leaves well-formed author CSS untouched and unwarned", () => {
    const css = "@media (min-width: 10px) {\n  .kept { color: blue; }\n}\n/* trailing note */\n";
    const { svelte, structuredWarnings, compiled } = emitAndCompile(withCss(css));
    expect(svelte).toContain(css.trim());
    expect(structuredWarnings.map((w) => w.code)).not.toContain("emit:css-not-rule-list");
    expect(compiled.warnings.filter((w) => w.code === "css_unused_selector")).toEqual([]);
  });

  it("does not touch the React stylesheet, which has no rule-list constraint", () => {
    // React injects the CSS through `dangerouslySetInnerHTML`, where a browser's
    // own error recovery applies — the same as the HTML emitter.
    const doc = withCss("color: red;\n.kept { color: blue; }");
    expect(emitReact(doc).jsx).toContain("color: red;");
  });
});

describe("toRuleList", () => {
  it("returns the input unchanged when it is already a rule list", () => {
    const css = "@import url(a.css);\n.a { color: red; }\n@media all { .b { color: blue; } }\n";
    const scan = toRuleList(css);
    expect(scan.issues).toEqual([]);
    expect(scan.css).toBe(css);
  });

  it("keeps braces that appear inside strings, comments and url()", () => {
    const css = '.a { content: "}"; background: url(a}b.png); } /* } */\n';
    expect(toRuleList(css).issues).toEqual([]);
  });

  it("drops a top-level declaration but keeps the rules around it", () => {
    const scan = toRuleList(".a { color: red; }\ncolor: blue;\n.b { color: green; }");
    expect(scan.issues.map((i) => i.kind)).toEqual(["declaration"]);
    expect(scan.css).toContain(".a {");
    expect(scan.css).toContain(".b {");
    expect(scan.css).not.toContain("color: blue");
  });

  it("closes an unclosed rule instead of dropping it", () => {
    const scan = toRuleList(".a { color: red;");
    expect(scan.issues.map((i) => i.kind)).toEqual(["unclosed"]);
    expect(scan.css.trim()).toBe(".a { color: red;\n}");
  });

  it("drops a stray closing brace", () => {
    const scan = toRuleList(".a { color: red; }\n}\n.b { color: blue; }");
    expect(scan.issues.map((i) => i.kind)).toEqual(["stray"]);
    expect(scan.css).toContain(".b {");
  });
});
