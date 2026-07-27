import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkCapabilitiesForSurface,
  getSurfaceCapabilities,
  getSurfaceFeatures,
  SETTING_UNSUPPORTED_CODE,
  SURFACE_CAPABILITIES,
  type SurfaceContext,
} from "../../src/core/capabilities.js";
import { processDocument } from "../../src/core/pipeline.js";
import type { SurfaceId } from "../../src/core/warnings.js";
import { emitHTML } from "../../src/emitters/html.js";
import { emitHTMLString } from "../../src/emitters/html-string.js";
import { LAZY_VIDEO_NO_LOADER_CODE } from "../../src/emitters/shared/lazy-video.js";
import { createDefaultSettings, SETTING_DEFINITIONS } from "../../src/ir/settings-definitions.js";
import type { Settings } from "../../src/ir/types.js";

const repoRoot = resolve(__dirname, "../..");

/**
 * A value the surface will not produce, per setting.
 *
 * These were originally "any non-default value", which is the shape of the bug
 * this suite failed to catch: the checker compared against the global default,
 * so a cell whose surface *diverges at the default* (Figma exports at 1x while
 * `use2xImages` defaults to `true`) could only be proven by picking the value
 * the surface actually produces — the harmless direction. Cells like that now
 * carry an explicit `value`, which is usually the default itself.
 */
const UNHONORED_VALUE: Partial<Record<keyof Settings, unknown>> = {
  imageFormat: ["svg"],
  writeImageFiles: false,
  pngTransparent: true,
  pngNumberOfColors: 64,
  jpgQuality: 50,
  use2xImages: false,
  htmlOutputPath: "custom-html/",
  renderTextAs: "image",
  renderRotatedSkewedTextAs: "image",
  output: "multiple-files",
  inlineSvg: true,
  svgIdPrefix: "gfx-",
  svgEmbedImages: true,
  createPromoImage: true,
  promoImageWidth: 2048,
  localPreviewTemplate: "preview.html",
  imageOutputPath: "somewhere-else/",
};

/**
 * Every `DEAD` cell in `internal-docs/capability-matrix.md`, transcribed with its
 * evidence id. Each one is a place where a user set something, the export
 * succeeded, and nothing happened. After this change each one warns.
 */
const DEAD_CELLS: ReadonlyArray<{
  id: string;
  surface: SurfaceId;
  setting: keyof Settings;
  path?: SurfaceContext["path"];
  format?: string;
  /** Overrides `UNHONORED_VALUE` where the surface diverges at the default. */
  value?: unknown;
}> = [
  { id: "D1", surface: "illustrator", setting: "imageFormat" },
  { id: "D2", surface: "figma", setting: "imageFormat" },
  { id: "D3", surface: "illustrator", setting: "writeImageFiles" },
  { id: "D4", surface: "figma", setting: "writeImageFiles" },
  { id: "D5", surface: "cli", setting: "writeImageFiles" },
  // D6/D7/D9 diverge at the default: Figma always exports alpha PNG at scale 1
  // with no quantizer, so the *default* is the value it cannot produce.
  { id: "D6", surface: "figma", setting: "pngTransparent", value: false },
  { id: "D7", surface: "figma", setting: "pngNumberOfColors", value: 128 },
  { id: "D8", surface: "figma", setting: "jpgQuality" },
  { id: "D9", surface: "figma", setting: "use2xImages", value: true },
  { id: "D10", surface: "illustrator", setting: "output" },
  { id: "D11", surface: "figma", setting: "htmlOutputPath" },
  { id: "D12", surface: "cli", setting: "htmlOutputPath" },
  { id: "D13", surface: "figma", setting: "renderTextAs" },
  { id: "D14", surface: "figma", setting: "renderRotatedSkewedTextAs" },
  { id: "D15", surface: "cli", setting: "renderRotatedSkewedTextAs" },
  { id: "D16", surface: "illustrator", setting: "inlineSvg" },
  { id: "D17", surface: "figma", setting: "inlineSvg" },
  { id: "D18", surface: "cli", setting: "inlineSvg" },
  { id: "D19", surface: "illustrator", setting: "svgIdPrefix" },
  { id: "D20", surface: "figma", setting: "svgIdPrefix" },
  { id: "D21", surface: "cli", setting: "svgIdPrefix" },
  { id: "D22", surface: "figma", setting: "svgEmbedImages" },
  { id: "D23", surface: "cli", setting: "svgEmbedImages" },
  { id: "D24", surface: "figma", setting: "createPromoImage" },
  { id: "D25", surface: "cli", setting: "createPromoImage" },
  { id: "D26", surface: "figma", setting: "promoImageWidth" },
  { id: "D27", surface: "cli", setting: "promoImageWidth" },
  { id: "D28", surface: "illustrator", setting: "localPreviewTemplate" },
  { id: "D29", surface: "figma", setting: "localPreviewTemplate" },
  { id: "D30", surface: "browser", setting: "localPreviewTemplate" },
];

function settingsWith(key: keyof Settings, value: unknown): Settings {
  const settings = createDefaultSettings();
  (settings as unknown as Record<string, unknown>)[key] = value;
  return settings;
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const SRC_FILES = listSourceFiles(join(repoRoot, "src"));

function sourceMentions(needle: string): string[] {
  return SRC_FILES.filter(
    (file) =>
      !file.endsWith("capabilities.ts") &&
      !file.endsWith("settings-definitions.ts") &&
      !file.endsWith("schema.ts") &&
      !file.endsWith("types.ts") &&
      readFileSync(file, "utf-8").includes(needle),
  ).map((file) => file.slice(repoRoot.length + 1));
}

describe("surface capability declarations", () => {
  it("declares all four surfaces plus the browser variant", () => {
    expect(SURFACE_CAPABILITIES.map((entry) => entry.surface)).toEqual([
      "illustrator",
      "after-effects",
      "figma",
      "cli",
      "browser",
    ]);
  });

  it("only declares settings that exist in the settings table", () => {
    const known = SETTING_DEFINITIONS.map((definition) => definition.key as string);
    for (const declaration of SURFACE_CAPABILITIES) {
      for (const key of Object.keys(declaration.settings)) {
        expect(known, `${declaration.surface} declares unknown setting ${key}`).toContain(key);
      }
    }
  });

  it("gives every non-honored setting a note saying what happens instead", () => {
    for (const declaration of SURFACE_CAPABILITIES) {
      for (const [key, support] of Object.entries(declaration.settings)) {
        if (support.status === "honored") continue;
        expect(support.note.length, `${declaration.surface}.${key} has no note`).toBeGreaterThan(0);
      }
    }
  });

  it("declares features for every surface", () => {
    for (const declaration of SURFACE_CAPABILITIES) {
      expect(Object.keys(getSurfaceFeatures(declaration.surface)).length).toBeGreaterThan(0);
    }
  });

  /**
   * The noise budget, pinned.
   *
   * An untouched export warns only where the surface genuinely does not do what
   * the default promises. Adding a name here means a real, newly-discovered
   * divergence; adding one carelessly is how a warning list becomes wallpaper.
   */
  const STANDING_WARNINGS: Record<Exclude<SurfaceId, "after-effects">, string[]> = {
    illustrator: [],
    // Always alpha PNG, scale 1, no quantizer — against defaults of opaque,
    // 2x, 128 colors.
    figma: ["pngTransparent", "pngNumberOfColors", "use2xImages"],
    cli: [],
    browser: [],
  };

  it("warns on an untouched export only where the surface diverges at the default", () => {
    for (const declaration of SURFACE_CAPABILITIES) {
      if (!declaration.runtimeChecked) continue;
      const warnings = checkCapabilitiesForSurface(createDefaultSettings(), {
        surface: declaration.surface,
        path: "render",
        format: "html",
      });
      expect(
        warnings.map((warning) => warning.setting),
        `${declaration.surface} standing warnings changed`,
      ).toEqual(STANDING_WARNINGS[declaration.surface as keyof typeof STANDING_WARNINGS]);
    }
  });

  it("every standing warning is a declared divergence, not a default comparison", () => {
    for (const [surface, settings] of Object.entries(STANDING_WARNINGS)) {
      const declaration = getSurfaceCapabilities(surface as SurfaceId);
      for (const setting of settings) {
        expect(
          Object.hasOwn(declaration.settings[setting], "divergesAtDefault"),
          `${surface}.${setting} warns at the default without declaring what it actually does`,
        ).toBe(true);
      }
    }
  });
});

/**
 * The regression the gate review found: the checker suppressed a warning
 * whenever the effective value equalled the *global* default, which proves
 * nothing about the surface. Figma exports at `scale: 1`
 * (`runtime-extract.ts:352,359`) while `use2xImages` defaults to `true`, so the
 * old check was silent in the three cases where the user is getting the
 * opposite of what was promised, and loud in the one case where the output is
 * exactly what was asked for.
 */
describe("use2xImages on Figma: request compared against reality, not the default", () => {
  const context = { surface: "figma", path: "render", format: "html" } as const;

  function check(settings: Settings) {
    return checkCapabilitiesForSurface(settings, context).filter(
      (warning) => warning.setting === "use2xImages",
    );
  }

  it("warns when the setting is omitted, because it resolves to the 2x default", () => {
    const warnings = check(createDefaultSettings());
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("at 1x");
  });

  it("warns when the user explicitly asks for 2x", () => {
    const warnings = check(settingsWith("use2xImages", true));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("it behaves as false");
    expect(warnings[0].message).toContain("at 1x");
  });

  it("warns when the resolved document carries the default value explicitly", () => {
    // Same as omitted once settings are resolved — the point is that resolution
    // cannot hide the divergence.
    const resolved = createDefaultSettings();
    expect(resolved.use2xImages).toBe(true);
    expect(check(resolved)).toHaveLength(1);
  });

  it("stays silent when the user asks for 1x, which is what Figma produces", () => {
    expect(check(settingsWith("use2xImages", false))).toEqual([]);
  });

  it("still warns on Illustrator only when 2x is genuinely unhonored", () => {
    // Illustrator does honor use2xImages (exporter.jsx:1101,1175), so neither
    // direction warns there. This is the false-positive half of the same bug.
    const illustrator = { surface: "illustrator", path: "render", format: "html" } as const;
    for (const value of [true, false]) {
      const warnings = checkCapabilitiesForSurface(settingsWith("use2xImages", value), illustrator);
      expect(warnings.filter((warning) => warning.setting === "use2xImages")).toEqual([]);
    }
  });
});

describe("DEAD settings now warn", () => {
  it.each(DEAD_CELLS)("$id: $setting on $surface warns, naming the setting and the surface", ({
    surface,
    setting,
    path,
    format,
    value: override,
  }) => {
    const value = override === undefined ? UNHONORED_VALUE[setting] : override;
    expect(value, `no unhonored value defined for ${String(setting)}`).toBeDefined();

    const warnings = checkCapabilitiesForSurface(settingsWith(setting, value), {
      surface,
      path: path ?? "render",
      format: format ?? "html",
    });

    const match = warnings.find((warning) => warning.setting === setting);
    expect(match, `${String(setting)} did not warn on ${surface}`).toBeDefined();
    expect(match?.code).toBe(SETTING_UNSUPPORTED_CODE);
    expect(match?.category).toBe("setting");
    expect(match?.surface).toBe(surface);
    expect(match?.message).toContain(String(setting));
    expect(match?.message).toContain(getSurfaceCapabilities(surface).label);
    // "what will happen instead"
    expect(match?.message.length).toBeGreaterThan(
      `Setting "${String(setting)}" is set to `.length + 40,
    );
  });

  it("covers all 30 DEAD cells recorded in the capability matrix", () => {
    expect(DEAD_CELLS).toHaveLength(30);
  });
});

describe("declarations match what the code actually does", () => {
  it("Illustrator cannot honor output: multiple-files because it never groups artboards", () => {
    // Matrix D10: src/extendscript/index.ts never imports group-artboards.
    const entry = readFileSync(join(repoRoot, "src/extendscript/index.ts"), "utf-8");
    expect(entry).not.toContain("group-artboards");
    expect(getSurfaceCapabilities("illustrator").settings.output.status).toBe("unsupported");
  });

  it("svgIdPrefix has no implementation anywhere, so no surface declares it honored", () => {
    // Matrix D19-D21. The only prefixing implementation was src/core/svg-postprocess.ts,
    // which had zero importers on any surface; it was deleted under D16 and nothing
    // replaces it. Both assertions below now hold trivially, which is the point: the
    // declaration is the only remaining statement about this setting, and it warns.
    expect(sourceMentions("settings.svgIdPrefix")).toEqual([]);
    expect(sourceMentions("svg-postprocess.js")).toEqual([]);
    for (const surface of ["illustrator", "figma", "cli", "browser"] as const) {
      expect(getSurfaceCapabilities(surface).settings.svgIdPrefix.status).toBe("unsupported");
    }
  });

  it("writeImageFiles is read by nothing, so no surface declares it honored", () => {
    // Matrix D3-D5.
    expect(sourceMentions("settings.writeImageFiles")).toEqual([]);
    for (const surface of ["illustrator", "figma", "cli", "browser"] as const) {
      expect(getSurfaceCapabilities(surface).settings.writeImageFiles.status).toBe("unsupported");
    }
  });

  it("the document-level inlineSvg setting is read by nothing", () => {
    // Matrix D16-D18: emitters read only the per-layer flag.
    expect(sourceMentions("settings.inlineSvg")).toEqual([]);
    for (const surface of ["illustrator", "figma", "cli", "browser"] as const) {
      expect(getSurfaceCapabilities(surface).settings.inlineSvg.status).toBe("unsupported");
    }
  });

  it("promo image generation exists only in the Illustrator exporter", () => {
    // Matrix D24-D27.
    expect(sourceMentions("settings.createPromoImage")).toEqual([]);
    expect(getSurfaceCapabilities("illustrator").settings.createPromoImage).toBeUndefined();
    for (const surface of ["figma", "cli", "browser"] as const) {
      expect(getSurfaceCapabilities(surface).settings.createPromoImage.status).toBe("unsupported");
    }
  });

  it("the browser converter diverges from the CLI on localPreviewTemplate only", () => {
    // Matrix D30 vs the CLI's `yes`: standalone-browser.ts reads the value only
    // to discard it, while the Node standalone emitter applies it.
    const cli = getSurfaceCapabilities("cli").settings;
    const browser = getSurfaceCapabilities("browser").settings;
    const diverging = Object.keys({ ...cli, ...browser }).filter(
      (key) => cli[key]?.status !== browser[key]?.status,
    );
    expect(diverging).toEqual(["localPreviewTemplate"]);
    expect(cli.localPreviewTemplate).toBeUndefined();
    expect(browser.localPreviewTemplate.status).toBe("unsupported");
  });

  it("output is honored for html but collapses for standalone", () => {
    // Matrix table B: registry-shared.ts discards groups for standalone.
    const base = { surface: "cli", path: "render" } as const;
    const asHtml = checkCapabilitiesForSurface(settingsWith("output", "multiple-files"), {
      ...base,
      format: "html",
    });
    const asStandalone = checkCapabilitiesForSurface(settingsWith("output", "multiple-files"), {
      ...base,
      format: "standalone",
    });
    expect(asHtml).toEqual([]);
    expect(asStandalone.map((warning) => warning.setting)).toEqual(["output"]);
  });

  it("rasterization settings are honored on `import svg` but inert on `render`", () => {
    // Matrix footnotes 1-2.
    const onImport = checkCapabilitiesForSurface(settingsWith("jpgQuality", 50), {
      surface: "cli",
      path: "import",
      format: "html",
    });
    const onRender = checkCapabilitiesForSurface(settingsWith("jpgQuality", 50), {
      surface: "cli",
      path: "render",
      format: "html",
    });
    expect(onImport).toEqual([]);
    expect(onRender.map((warning) => warning.setting)).toEqual(["jpgQuality"]);
  });

  it("Illustrator honors jpg but falls back to 8-bit PNG for png24 and svg", () => {
    // Matrix D1: exporter.jsx branches on "jpg" only.
    const context = { surface: "illustrator", path: "render", format: "html" } as const;
    expect(checkCapabilitiesForSurface(settingsWith("imageFormat", ["jpg"]), context)).toEqual([]);
    expect(
      checkCapabilitiesForSurface(settingsWith("imageFormat", ["png24"]), context),
    ).toHaveLength(1);
    expect(checkCapabilitiesForSurface(settingsWith("imageFormat", ["svg"]), context)).toHaveLength(
      1,
    );
  });

  it("Figma honors the format it actually produces and warns for the rest", () => {
    // Matrix D2: runtime-extract.ts exports full-color alpha PNG, which is
    // png24. Warning about `png24` would be the same false positive as warning
    // about `use2xImages: false`.
    const context = { surface: "figma", path: "render", format: "html" } as const;
    const forFormat = (value: string[]) =>
      checkCapabilitiesForSurface(settingsWith("imageFormat", value), context).filter(
        (warning) => warning.setting === "imageFormat",
      );
    expect(forFormat(["auto"])).toEqual([]);
    expect(forFormat(["png24"])).toEqual([]);
    expect(forFormat(["png"])).toHaveLength(1);
    expect(forFormat(["jpg"])).toHaveLength(1);
    expect(forFormat(["svg"])).toHaveLength(1);
  });
});

/**
 * D31 — `useLazyLoader` is dead at its default, but only for video: images get
 * native `loading="lazy"`, which works. Whether a document is affected is a
 * property of the document, not of the settings, so the declaration defers to
 * the emitter and the emitter warns at the call site that produces the broken
 * markup. Warning from the settings checker would fire on every export ever
 * made, including the image-only ones where the claim would be false.
 */
describe("D31: lazy video has no loader", () => {
  const lazySurfaces = ["illustrator", "figma", "cli", "browser"] as const;

  it("is declared partial on every surface and deferred to the emitter", () => {
    for (const surface of lazySurfaces) {
      const support = getSurfaceCapabilities(surface).settings.useLazyLoader;
      expect(support, `${surface} does not declare useLazyLoader`).toBeDefined();
      expect(support.status).toBe("partial");
      expect(support.warnedByEmitter).toBe(LAZY_VIDEO_NO_LOADER_CODE);
    }
  });

  it("stays out of the settings warnings on every surface", () => {
    for (const surface of lazySurfaces) {
      const warnings = checkCapabilitiesForSurface(createDefaultSettings(), {
        surface,
        path: "render",
        format: "html",
      });
      expect(warnings.some((warning) => warning.setting === "useLazyLoader")).toBe(false);
    }
  });

  it("no loader script exists anywhere in src/, which is why this is dead", () => {
    for (const needle of ["IntersectionObserver", "lazyload", "loadImages"]) {
      // lazy-video.ts is the module that documents the absence.
      const mentions = sourceMentions(needle).filter(
        (file) => !file.endsWith("shared/lazy-video.ts"),
      );
      expect(mentions, `${needle} appeared; re-check the declaration`).toEqual([]);
    }
  });

  it("warns once per lazy video layer, from both HTML emitters identically", () => {
    const doc = JSON.parse(
      readFileSync(join(repoRoot, "test/fixtures/ir/video-layer.json"), "utf-8"),
    );
    const { document, groups } = processDocument(doc, {
      surface: { surface: "cli", path: "render", format: "html" },
    });

    expect(groups).toHaveLength(1);
    const hast = emitHTML(document);
    const string = emitHTMLString(document);

    for (const result of [hast, string]) {
      const lazy = result.structuredWarnings.filter(
        (warning) => warning.code === LAZY_VIDEO_NO_LOADER_CODE,
      );
      expect(lazy).toHaveLength(1);
      expect(lazy[0].category).toBe("markup");
      expect(lazy[0].setting).toBe("useLazyLoader");
      expect(lazy[0].layerId).toBeDefined();
      expect(result.html).toContain("data-src=");
    }
    expect(hast.structuredWarnings).toEqual(string.structuredWarnings);
  });

  it("says nothing when the user opts out, because a direct src is emitted", () => {
    const doc = JSON.parse(
      readFileSync(join(repoRoot, "test/fixtures/ir/video-layer.json"), "utf-8"),
    );
    doc.settings = { ...(doc.settings ?? {}), useLazyLoader: false };
    const { document } = processDocument(doc, {
      surface: { surface: "cli", path: "render", format: "html" },
    });
    const result = emitHTMLString(document);

    expect(
      result.structuredWarnings.some((warning) => warning.code === LAZY_VIDEO_NO_LOADER_CODE),
    ).toBe(false);
    expect(result.html).toContain("src=");
    expect(result.html).not.toContain("data-src=");
  });
});

/**
 * A declaration nobody runs is documentation, and documentation that claims to
 * be enforcement is the thing this whole area exists to stop.
 */
describe("declarations are only claimed as enforced where they run", () => {
  it("After Effects is the one surface whose declaration is not enforced", () => {
    const unenforced = SURFACE_CAPABILITIES.filter(
      (declaration) => !declaration.runtimeChecked,
    ).map((declaration) => declaration.surface);
    expect(unenforced).toEqual(["after-effects"]);
  });

  it("the After Effects exporter cannot run the checker: it never loads the core", () => {
    const exporter = readFileSync(join(repoRoot, "plugins/after-effects/exporter.jsx"), "utf-8");
    expect(exporter).not.toContain("All2Html");
    expect(exporter).not.toContain("checkSurfaceCapabilities");
  });

  it("every enforced surface has a call site that passes its identity", () => {
    const callSites: Record<string, string> = {
      illustrator: "src/extendscript/index.ts",
      figma: "plugins/figma/src/export.ts",
      cli: "src/cli/index.ts",
      browser: "src/browser.ts",
    };
    for (const declaration of SURFACE_CAPABILITIES) {
      if (!declaration.runtimeChecked) continue;
      const source = readFileSync(join(repoRoot, callSites[declaration.surface]), "utf-8");
      expect(
        source.includes(`surface: "${declaration.surface}"`) ||
          source.includes("illustratorCapabilities"),
        `${declaration.surface} declares runtimeChecked with no call site`,
      ).toBe(true);
    }
  });
});

describe("the pipeline warns for the active surface", () => {
  const ir = {
    irVersion: "0.1.0",
    source: { tool: "test", version: "0" },
    metadata: { slug: "cap" },
    settings: { output: "multiple-files", svgIdPrefix: "gfx-" },
    fonts: [],
    customBlocks: [],
    assets: {},
    artboards: [
      {
        id: "ab-1",
        name: "cap",
        width: 600,
        height: 400,
        layers: [
          {
            id: "layer-1",
            name: "art",
            type: "default",
            visible: true,
            opacity: 100,
            inlineSvg: false,
            elements: [],
          },
        ],
      },
    ],
  };

  it("names a DEAD setting in a plain-string warning on the CLI", () => {
    const result = processDocument(structuredClone(ir), {
      surface: { surface: "cli", path: "render", format: "html" },
    });

    expect(result.warnings.some((warning) => warning.includes("svgIdPrefix"))).toBe(true);
    const structured = result.structuredWarnings.find(
      (warning) => warning.setting === "svgIdPrefix",
    );
    expect(structured?.code).toBe(SETTING_UNSUPPORTED_CODE);
    expect(structured?.surface).toBe("cli");
    // `output: multiple-files` is honored on the CLI html path, so it must not warn.
    expect(result.structuredWarnings.some((warning) => warning.setting === "output")).toBe(false);
  });

  it("warns about output: multiple-files on Figma standalone but not Figma html", () => {
    const asHtml = processDocument(structuredClone(ir), {
      surface: { surface: "figma", format: "html" },
    });
    const asStandalone = processDocument(structuredClone(ir), {
      surface: { surface: "figma", format: "standalone" },
    });

    expect(asHtml.structuredWarnings.some((warning) => warning.setting === "output")).toBe(false);
    expect(asStandalone.structuredWarnings.some((warning) => warning.setting === "output")).toBe(
      true,
    );
  });

  it("keeps the plain-string projection in sync with the structured warnings", () => {
    const result = processDocument(structuredClone(ir), {
      surface: { surface: "cli", path: "render", format: "html" },
    });
    expect(result.warnings).toEqual(result.structuredWarnings.map((warning) => warning.message));
  });
});
