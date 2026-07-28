import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { describe, expect, it } from "vitest";
import { processDocument } from "../../src/core/pipeline.js";
import { emitHTML } from "../../src/emitters/html.js";
import { emitReact } from "../../src/emitters/react.js";
import { escapeScriptContent } from "../../src/emitters/shared/escape.js";
import {
  lazyVideoLoaderCall,
  lazyVideoLoaderFunction,
} from "../../src/emitters/shared/lazy-video.js";
import { emitStandalone } from "../../src/emitters/standalone.js";
import { emitSvelte } from "../../src/emitters/svelte.js";
import type { EmitterReadyDocument } from "../../src/ir/types.js";

/**
 * `useLazyLoader` defaults to true, so every video ever exported was written as
 * `<video data-src="…">` with no `src`. Nothing anywhere swapped them in: the
 * emitters warned (`video:lazy-src-no-loader`) and shipped the broken markup.
 *
 * These tests are about the loader that closes that. The interesting properties
 * are that it exists exactly when it is needed, that it reaches every output
 * format (the two framework formats need a different vehicle — a `<script>` in
 * an `{@html}` chunk is inserted without executing), and that it survives the
 * serializer's script-content grammar unmangled.
 */

const fixturesDir = resolve(import.meta.dirname, "../fixtures/ir");

function load(name: string) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

function processed(name: string, settings?: Record<string, unknown>): EmitterReadyDocument {
  const raw = load(name);
  if (settings) raw.settings = { ...raw.settings, ...settings };
  return processDocument(raw).document;
}

/** Parse an emitted fragment as a browser would, optionally running its scripts. */
function parse(html: string, runScripts: boolean) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    runScripts: runScripts ? "dangerously" : undefined,
    virtualConsole: new VirtualConsole(),
  }).window.document;
}

function loaderScripts(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(
    /<script[^>]*data-all2html="lazy-video-loader"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    out.push(match[1]);
  }
  return out;
}

describe("the lazy video loader is emitted only when it is needed", () => {
  it("emits exactly one loader for a document with a lazy video", () => {
    const doc = processed("video-layer.json");
    for (const { html } of [emitHTML(doc), emitStandalone(doc)]) {
      expect(loaderScripts(html)).toHaveLength(1);
      expect(html).toContain('data-src="https://example.com/video.mp4"');
    }
  });

  it("emits one loader, not one per video, when a document has several", () => {
    const raw = load("video-layer.json");
    const layers = raw.artboards[0].layers;
    const videoLayer = layers.find((layer: { type: string }) => layer.type === "video");
    layers.push({
      ...structuredClone(videoLayer),
      id: "artboard:desktop:layer:bg-video-2",
      name: "bg-video-2",
    });
    const { html } = emitHTML(processDocument(raw).document);

    expect(html.match(/<video/g)).toHaveLength(2);
    expect(loaderScripts(html)).toHaveLength(1);
  });

  it("emits no loader for a document with no video", () => {
    const doc = processed("single-artboard-basic.json");
    for (const { html } of [emitHTML(doc), emitStandalone(doc)]) {
      expect(loaderScripts(html)).toHaveLength(0);
      expect(html).not.toContain("IntersectionObserver");
    }
  });

  it("emits no loader when the author turned lazy loading off", () => {
    const doc = processed("video-layer.json", { useLazyLoader: false });
    const { html } = emitHTML(doc);

    expect(loaderScripts(html)).toHaveLength(0);
    expect(html).toContain('src="https://example.com/video.mp4"');
    expect(html).not.toContain("data-src");
  });
});

describe("the loader survives the serializer", () => {
  it("goes through the script-content grammar and comes out unchanged", () => {
    // It is a normal `text` child of a `script` element, so
    // `escapeScriptContent()` runs on it. Being a fixed point of that function
    // is what makes the emitted source executable — a `raw()` node would skip
    // the check entirely, which is the thing not to do.
    const source = lazyVideoLoaderCall("document");
    expect(escapeScriptContent(source)).toBe(source);
    expect(source).not.toContain("</script");
    expect(source).not.toContain("<!--");

    const { html } = emitHTML(processed("video-layer.json"));
    expect(loaderScripts(html)[0]).toContain(source);
  });

  it("actually runs in a browser and swaps data-src into src", () => {
    const { html } = emitHTML(processed("video-layer.json"));

    // Inert first: this is the state every export has shipped until now.
    const inert = parse(html, false).querySelector("video");
    expect(inert?.getAttribute("data-src")).toBe("https://example.com/video.mp4");
    expect(inert?.getAttribute("src")).toBeNull();

    // Then with scripts enabled, so the emitted `<script>` element runs the way
    // it would on a CMS page rather than being eval'd out of context.
    const live = parse(html, true).querySelector("video");
    expect(live?.getAttribute("src")).toBe("https://example.com/video.mp4");
    expect(live?.getAttribute("data-src")).toBeNull();
  });

  it("falls back to loading immediately where IntersectionObserver is missing", () => {
    // jsdom has none, which is why the assertion above passed at all: without
    // the fallback the video would still be waiting to intersect.
    const { html } = emitHTML(processed("video-layer.json"));
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
      runScripts: "dangerously",
      virtualConsole: new VirtualConsole(),
    });
    expect(dom.window.IntersectionObserver).toBeUndefined();
    expect(dom.window.document.querySelector("video")?.getAttribute("src")).toBe(
      "https://example.com/video.mp4",
    );
  });

  it("returns a teardown, so a framework effect can disconnect the observer", () => {
    // Every exit path returns one, including the two early ones — an
    // IntersectionObserver that outlives its component keeps every element it
    // observes alive, and `useEffect`/`$effect` only clean up what is returned.
    const { html } = emitHTML(processed("video-layer.json"));
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
      runScripts: "dangerously",
      virtualConsole: new VirtualConsole(),
    });
    const factory = dom.window.eval(`(${lazyVideoLoaderFunction()})`) as (root: unknown) => unknown;

    expect(typeof factory(dom.window.document)).toBe("function");
    // Empty root: the no-video early return still hands back a teardown.
    expect(typeof factory(dom.window.document.createElement("div"))).toBe("function");
  });

  it("is idempotent, so two graphics on one page cannot double-load a video", () => {
    const { html } = emitHTML(processed("video-layer.json"));
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
      runScripts: "dangerously",
      virtualConsole: new VirtualConsole(),
    });

    const first = dom.window.document.querySelector("video")?.getAttribute("src");
    dom.window.eval(loaderScripts(html)[0]);

    // The selector stops matching once `data-src` is consumed, so a second
    // loader on the page is a no-op rather than a reload.
    expect(dom.window.document.querySelector("video")?.getAttribute("src")).toBe(first);
    expect(dom.window.document.querySelector("video")?.getAttribute("data-src")).toBeNull();
  });
});

describe("the framework emitters run the loader as a lifecycle effect", () => {
  it("Svelte binds the root and runs it from $effect, with no dead script in the markup", () => {
    const { svelte } = emitSvelte(processed("video-layer.json"));

    expect(svelte).toContain("bind:this={rootEl}");
    expect(svelte).toContain("$effect(");
    expect(svelte).toContain("IntersectionObserver");
    // A `<script>` inside `{@html}` is inserted and never executed, so the HTML
    // tree's loader element must not survive into the chunk.
    expect(svelte).not.toContain("lazy-video-loader");
  });

  it("React holds a ref and runs it from useEffect", () => {
    const { jsx } = emitReact(processed("video-layer.json"));

    expect(jsx).toContain("useRef");
    expect(jsx).toContain("useEffect");
    expect(jsx).toContain("ref={rootRef}");
    expect(jsx).toContain("IntersectionObserver");
    expect(jsx).not.toContain("lazy-video-loader");

    const { jsx: tsx } = emitReact(processed("video-layer.json"), undefined, {
      typescript: true,
    });
    expect(tsx).toContain("useRef<HTMLDivElement | null>(null)");
  });

  it("adds neither hook nor ref to a component with no video", () => {
    const doc = processed("single-artboard-basic.json");
    const { svelte } = emitSvelte(doc);
    const { jsx } = emitReact(doc);

    expect(svelte).not.toContain("$effect");
    expect(svelte).not.toContain("bind:this");
    expect(jsx).not.toContain("useEffect");
    expect(jsx).not.toContain("useRef");
    expect(jsx).toContain('import React, { useMemo } from "react";');
  });
});
