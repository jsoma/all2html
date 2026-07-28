import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { transformSync } from "esbuild";
import { compile } from "svelte/compiler";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitReact } from "../../src/emitters/react.js";
import { emitSvelte } from "../../src/emitters/svelte.js";
import type { EmitterReadyDocument, EmitterReadySnippetElement } from "../../src/ir/types.js";

/**
 * A snippet key is a **layer name**: arbitrary text a designer typed, which the
 * framework emitters turn into JavaScript source the desk then compiles. Three
 * separate failures used to follow from that, all reachable by renaming a layer:
 *
 *  - a key could carry executable code into the generated component, because
 *    both emitters wrote keys into *comments* (`JSON.stringify` does not escape
 *    `*​/`, and nothing escaped a newline in Svelte's `//` line comments);
 *  - a key that is a JS keyword (`default`) produced a component that does not
 *    parse;
 *  - a key matching an identifier the emitter generates (`cssText`,
 *    `resolveHtml`) shadowed it — the `<style>` element rendered the snippet
 *    prop instead of the stylesheet.
 *
 * Every case here asserts two things: the emitted component **compiles** with
 * the real compiler, and nothing the layer name contains **executes**.
 */

function loadAndProcess(fixtureName: string): EmitterReadyDocument {
  const ir = JSON.parse(readFileSync(`test/fixtures/ir/${fixtureName}`, "utf-8"));
  return processDocument(ir).document;
}

function withSnippetKeys(keys: string[]): EmitterReadyDocument {
  const doc = loadAndProcess("single-artboard-basic.json");
  for (const key of keys) {
    const snippet: EmitterReadySnippetElement = {
      type: "snippet",
      key,
      position: { x: 0, y: 0, width: 100, height: 100 },
      computedPosition: { top: "10%", left: "5%", width: "90%" },
    };
    doc.artboards[0].layers[0].elements.push(snippet);
  }
  return doc;
}

/**
 * A stand-in for a framework runtime: every property is a function, and every
 * callback handed to one is invoked with the same stub. Svelte's server output
 * puts the component body inside `$$renderer.component(($$renderer) => { … })`,
 * so a stub that only returned `undefined` would never run the body — and never
 * see injected code.
 */
function frameworkStub(): unknown {
  const invoke = (...args: unknown[]): unknown => {
    for (const arg of args) {
      if (typeof arg !== "function") continue;
      try {
        (arg as (runtime: unknown) => void)(stub);
      } catch {
        // Anything past the injection point is the stub's own fault.
      }
    }
    return stub;
  };
  const stub: unknown = new Proxy(invoke, {
    get: () => invoke,
    apply: (_target, _thisArg, args: unknown[]) => invoke(...args),
  });
  return stub;
}

/**
 * Run a generated component module in a fresh vm context and report anything it
 * assigned to the global. Module scope runs on load; the component body runs on
 * the call, which is allowed to throw once it reaches the stubbed framework
 * runtime — injected code sits at the top of the body, ahead of that.
 */
function runModule(
  code: string,
  loader: "jsx" | "js",
  requireStub: (id: string) => unknown,
  args: unknown[],
) {
  const cjs = transformSync(code, { loader, jsx: "transform", format: "cjs" }).code;
  const sandbox: Record<string, unknown> = { module: { exports: {} }, require: requireStub };
  sandbox.exports = (sandbox.module as { exports: unknown }).exports;
  createContext(sandbox);
  runInContext(cjs, sandbox);
  const component = (sandbox.module as { exports: { default?: (...a: unknown[]) => unknown } })
    .exports.default;
  try {
    component?.(...args);
  } catch {
    // Stubbed runtime; only the side effects before it matter here.
  }
  return sandbox;
}

const reactStub = () =>
  new Proxy(
    {
      useMemo: (factory: () => unknown) => factory(),
      createElement: () => null,
      Fragment: "fragment",
    },
    { get: (target: Record<string, unknown>, key: string) => target[key] ?? (() => undefined) },
  );

/** Emit, compile, execute. Returns everything the assertions need. */
function emitAndRun(doc: EmitterReadyDocument) {
  const { svelte } = emitSvelte(doc);
  const { jsx } = emitReact(doc);
  const { jsx: tsx } = emitReact(doc, undefined, { typescript: true });

  // Real Svelte compiler: a keyword prop or a shadowed declaration is an error.
  const compiled = compile(svelte, { name: "Graphic", filename: "Graphic.svelte" });
  const ssr = compile(svelte, { name: "Graphic", filename: "Graphic.svelte", generate: "server" });

  transformSync(tsx, { loader: "tsx", jsx: "preserve", sourcefile: "Graphic.tsx" });

  // Svelte's server component takes the renderer as its first argument; React's
  // takes props. Both bodies run, which is what the assertions watch.
  const svelteRuntime = frameworkStub();
  const svelteGlobals = runModule(ssr.js.code, "js", () => svelteRuntime, [svelteRuntime, {}]);
  const reactGlobals = runModule(jsx, "jsx", reactStub, [{}]);

  return { svelte, jsx, tsx, compiled, svelteGlobals, reactGlobals };
}

describe("a layer name cannot inject code into the generated component", () => {
  // `JSON.stringify` does not escape `*​/`, and React wrote the key into a
  // `/** … */` doc comment. This key closed it and the rest ran as source.
  it("survives a key that closes a block comment", () => {
    const doc = withSnippetKeys(["a*/;globalThis.PWNED = 1;/*b"]);
    const { svelteGlobals, reactGlobals } = emitAndRun(doc);
    expect(reactGlobals.PWNED).toBeUndefined();
    expect(svelteGlobals.PWNED).toBeUndefined();
  });

  // Svelte wrote the key into a `//` line comment with no escaping at all, so a
  // newline ended the comment and the next line was a statement — it compiled
  // cleanly and the statement reached the compiled output.
  it("survives a key containing a newline", () => {
    const doc = withSnippetKeys(['chart\nglobalThis.PWNED = "yes"; //']);
    const { svelteGlobals, reactGlobals } = emitAndRun(doc);
    expect(svelteGlobals.PWNED).toBeUndefined();
    expect(reactGlobals.PWNED).toBeUndefined();
  });

  // A Svelte `<script>` block is still an HTML script element: `</script>` in a
  // JS string closes it, and what follows is markup.
  it("survives a key that closes the script element", () => {
    const doc = withSnippetKeys(['x</script><script>globalThis.PWNED = 1;</script><b x="']);
    const { svelte, svelteGlobals } = emitAndRun(doc);
    expect(svelteGlobals.PWNED).toBeUndefined();
    // Inside the script blocks the key is escaped, so nothing closes them early.
    // (In markup it is an ordinary attribute value, which the parser handles.)
    for (const block of svelte.match(/<script[^>]*>[\s\S]*?<\/script>/g) ?? []) {
      expect(block.slice(0, -"</script>".length)).not.toContain("</script");
    }
  });

  it("puts no layer name inside a comment in either component", () => {
    const key = "chart\nglobalThis.PWNED = 1; //*/ <!-- </script>";
    const { svelte, jsx, tsx } = emitAndRun(withSnippetKeys([key]));
    // The key survives as data — in `snippetKeys` and in the `data-key`
    // attribute — and never as commented-out prose.
    for (const source of [svelte, jsx, tsx]) {
      const lines = source.split("\n").filter((line) => line.includes("globalThis.PWNED"));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const trimmed = line.trim();
        expect(trimmed.startsWith("//")).toBe(false);
        expect(trimmed.startsWith("/*")).toBe(false);
        expect(trimmed.startsWith("*")).toBe(false);
      }
      expect(lines.some((line) => line.includes("snippetKeys"))).toBe(true);
    }
  });
});

describe("a layer name cannot break the generated component", () => {
  it("compiles with a layer named after a JS keyword", () => {
    const doc = withSnippetKeys(["default"]);
    const { svelte, jsx, tsx } = emitAndRun(doc);

    // `let { …, default } = $props()` / `function Graphic({ …, default })` were
    // both SyntaxErrors. Only 7 names used to be guarded.
    expect(svelte).toContain("default_");
    expect(svelte).not.toMatch(/[,{]\s*default\s*[,}]/);
    expect(jsx).toContain("default_");
    expect(tsx).toContain("default_?: ReactNode;");
  });

  it("compiles with a layer named after every reserved word", () => {
    const keywords = ["default", "class", "function", "return", "new", "typeof", "let", "import"];
    const { svelte, jsx } = emitAndRun(withSnippetKeys(keywords));
    for (const keyword of keywords) {
      expect(svelte).toContain(`${keyword}_`);
      expect(jsx).toContain(`${keyword}_`);
    }
  });

  it("does not let a layer name shadow the React stylesheet", () => {
    const { jsx, tsx } = emitAndRun(withSnippetKeys(["cssText"]));
    // The `<style>` element must still render the stylesheet const, and the
    // stylesheet must still be a template literal, not a prop.
    expect(jsx).toContain("<style dangerouslySetInnerHTML={{ __html: cssText }} />");
    expect(jsx).toMatch(/^const cssText = `/m);
    expect(jsx).toContain("cssText_");
    expect(tsx).toContain("cssText_?: ReactNode;");
  });

  it("does not let a layer name redeclare the Svelte asset resolver", () => {
    // `resolveHtml` was "Identifier already declared" — a hard compile error.
    const { svelte } = emitAndRun(withSnippetKeys(["resolveHtml", "ASSET_TOKEN"]));
    expect(svelte).toContain("resolveHtml_");
    expect(svelte).toContain("ASSET_TOKEN_");
    expect(svelte.match(/function resolveHtml\(/g)).toHaveLength(1);
  });

  it("does not let a layer name become a Svelte rune", () => {
    // Svelte rejects every `$`-prefixed binding: `dollar_prefix_invalid`.
    const { svelte } = emitAndRun(withSnippetKeys(["$props", "$state"]));
    expect(svelte).not.toMatch(/[,{]\s*\$props\s*[,}]/);
    expect(svelte).toContain("_$props");
  });

  it("keeps two colliding keys as two distinct props", () => {
    const { svelte, jsx } = emitAndRun(withSnippetKeys(["my chart", "my-chart"]));
    expect(svelte).toContain("my_chart_");
    expect(jsx).toContain("my_chart_");
  });
});
